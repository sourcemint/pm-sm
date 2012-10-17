
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const EXEC = require("child_process").exec;
const SPAWN = require("child_process").spawn;
const Q = require("sourcemint-util-js/lib/q");
const TERM = require("sourcemint-util-js/lib/term");
const UTIL = require("sourcemint-util-js/lib/util");
const WAIT_FOR = require("sourcemint-util-js/lib/wait-for");
const PACKAGES = require("sourcemint-pinf-js/lib/packages");
const PM = require("../pm");
const NPM = require("sourcemint-pm-npm/lib/npm");
const URI_PARSER = require("../uri-parser");
const SM_STATUS = require("./status");
const CORE = require("../core");


exports.main = function(pm, options) {
    var self = this;

    options = options || {};

    if (pm.context.package && pm.context.program) {
        
        if (pm.context.package.path.substring(0, pm.context.program.package.path.length) != pm.context.program.package.path &&
            pm.context.package.path.substring(0, pm.context.homeBasePath.length) != pm.context.homeBasePath) {

            TERM.stdout.writenl("\0yellow(SKIP: Not installing new package at '" + pm.context.package.path + "' as path is outside of program root '" + pm.context.program.package.path + "'.\0)");

            return Q.ref();
        }
    }

    if (typeof options.descriptorOverlay !== "undefined") {
        if (typeof options.descriptorOverlay.pm === "undefined") {
            options.descriptorOverlay.pm = false;
        }
        UTIL.deepUpdate(pm.context.program.package.descriptor.json, options.descriptorOverlay);
    }

    if (options.pm) {

        if (options.locator) {

            var parsedLocator = URI_PARSER.parse(options.locator);

            if (typeof parsedLocator.vendor !== "undefined" && typeof parsedLocator.vendor.rev !== "undefined" && parsedLocator.originalLocatorPM === "git-read") {

                if (!parsedLocator.locators["git-read"]) {
                    var deferred = Q.defer();
                    deferred.reject(new Error("Cloud not determine 'locators[\"git-read\"]' for uri '" + options.locator + "'!"));
                    return deferred.promise;
                }
                options.name = undefined;
                options.locator = parsedLocator.locators["git-read"] + "#" + parsedLocator.vendor.rev;
                options.forceClone = true;
            }
        }

        return require("sourcemint-pm-" + options.pm + "/lib/pm").install(pm, options);
    }

    ASSERT(typeof pm.context.program !== "undefined", "'context.program' required!");


    function updateOutdatedTopLevel(statusTree) {

        return statusTree.forEachNode(function(node) {

            if (node.level === 0) {
                // We are in the root package.
                // TODO: Git pull if git not dirty or ahead.
                return true;    // Go deeper.
            }

            // If we are in a transitive package we ignore as we will deal with transitive packages separately after.
            if (node.level > 1) return false;   // Don't go deeper.

            if (node.status.summary.isLinked) {
                TERM.stdout.writenl(
                    "\0yellow(SKIP: Not updating package '" + node.name + "' at '" + node.path + "' as it is linked in from outside the program root" +
                    ((node.status.git)?" (git[" + node.status.git.rev + "] repository present)":"") +
                    ".\0)");
                return false;
            }
            if (node.status.git) {
                TERM.stdout.writenl("\0yellow(SKIP: Not updating package '" + node.name + "' at '" + node.path + "' as it is in write mode (git[" + node.status.git.rev + "] repository present).\0)");
                return false;
            }

            if (options.verbose) {
                TERM.stdout.writenl("Checking package '" + node.name + "' at: " + node.path);
            }

            if (!node.status.summary.installed) {
                TERM.stdout.writenl("\0cyan(Installing package '" + node.name + "' at: " + node.path + "\0)");
            } else
            if (node.status.summary.newInSelectorVersion) {
                TERM.stdout.writenl("\0cyan(Updating package '" + node.name + "' at: " + node.path + "\0)");
            } else {
                // Package present and at latest desired revision.
                return false;
            }

            // TODO: What is this used for? Can we deprecate it?
            if (PATH.existsSync(node.status.locator.location)) {
                TERM.stdout.writenl("\0yellow(SKIP: Not updating package '" + node.name + "' at '" + node.path + "' as its locator is an absolute path.\0)");
                return false;
            }

            return PM.forPackagePath(node.path, pm).then(function(pm) {

                var args = UTIL.copy(options);
                args.pm = node.status.locator.pm;
                args.locator = node.status.summary.newInSelectorLocation;
                args.descriptorOverlay = node.status.locator.descriptorOverlay;
                args.name = PATH.basename(pm.context.package.path);
                args.force = true;

                return pm.path(args).then(function(path) {

                    return Q.when(pm.install(args), function() {

                        if (!PATH.existsSync(PATH.join(path, ".sourcemint"))) {
                            FS.mkdirSync(PATH.join(path, ".sourcemint"));
                        }
                        FS.writeFile(PATH.join(path, ".sourcemint", "source.json"), JSON.stringify({
                            url: args.locator,
                            nodeVersion: process.version,
                            time: pm.context.time
                        }));
                    }).then(function() {
                        return node.refresh({
                            now: true,
                            time: options.time,
                            verbose: options.verbose
                        }).then(function(changes) {
                            if (!changes || (node.status.summary.newInSelectorVersion || !node.status.summary.installed)) {

                                console.log("node.status", node.status);

                                TERM.stdout.writenl("\0red([sm] ERROR: " + "Updating top-level package '" + node.path + "' from '" + node.status.summary.version + "' to '" + node.status.summary.newInSelectorVersion + "' as triggered by 'newInSelectorVersion'!" + "\0)");
                                TERM.stdout.writenl("\0red([sm] ERROR: " + "The package should be updated by now as we did everything we could to update it." + "\0)");
                                TERM.stdout.writenl("\0red([sm] ERROR: " + "Check package to see if it is at latest version as desired. If it is then the sourcemint version check logic has a bug. Please report issue and provide details about version of package and which version is requested based on parent package dependency declaration." + "\0)");

                                throw new Error("Error updating top-level package");
                            }
                        });
                    }).fail(function(err) {
                        if (node.parent) {
                            err.message += " In package: " + node.parent.path;
                        }
                        return err;
                    });
                });
            });
        });
    }

    function updateRootLevel() {

        // NOTE: By default we expect a NPM-compatible package unless otherwise specified.
        var pmDeclaration = pm.context.program.package.descriptor.pm;
        if (options.descriptorOverlay && typeof options.descriptorOverlay.pm !== "undefined") {
            pmDeclaration = options.descriptorOverlay.pm;
        }
        if (pmDeclaration !== false && (typeof pmDeclaration === "undefined" || pmDeclaration === "npm") && options["no-native-install"] !== true) {
            return Q.call(function() {

                var opts = {
                    env: {
                        "SM_CLI_CALL": "true",
                        "SM_TIME": pm.context.SM_PROGRAM,
                        "SM_PROGRAM": pm.context.SM_PROGRAM
                    },
                    verbose: options.verbose,
                    // If `dev === true` the dev dependencies get installed.
                    dev: (pm.context.SM_PROGRAM === pm.context.program.package.path)?true:false
                };
                if (options.update === true) {
                    // NOTE: We do an `install` first and then an update so that `devDependencies` get installed.
                    return NPM.install(pm.context.program.package.path, ".", opts).then(function() {

                        //return NPM.update(pm.context.program.package.path, opts);
                    });
                } else {
                    return NPM.install(pm.context.program.package.path, ".", opts);
                }
            });
        }
    }

    var announced_updateOutdatedInSelectorTransitive_skipped = {};

    function updateOutdatedInSelectorTransitive(statusTree) {

        function findOutdated() {
            var outdated = {};
            return statusTree.forEachNode(function(node) {

                // We don't care about the root package and traverse deeper.
                if (node.level === 0) return true;
                // We traverse all level 1 packages (even if dev dependency) but ignore packages themselves.
                if (node.level === 1) return true;
                // If node is not direct child of parent we ignore and don't traverse deeper as it would have been dealt with already.
                if (node.status.summary.isWithinParents) return false;
                // If node is not a production NPM dependency we ignore it.
                if (node.status.locator.viaAttribute !== "dependencies") return false;

                var parentLinked = false;
                var parentWriteMode = false;
                return node.forEachParent(function(node, level) {
                    if (node.status.summary.isLinked && !parentLinked) {
                        parentLinked = node;
                    }
                    if (node.status.summary.isLinked && !parentWriteMode) {
                        parentWriteMode = node;
                    }
                }).then(function() {
                    if (node.status.summary.newInSelectorVersion || !node.status.summary.installed) {
                        if (node.status.summary.isLinked) {
                            if (!announced_updateOutdatedInSelectorTransitive_skipped[node.path]) {
                                announced_updateOutdatedInSelectorTransitive_skipped[node.path] = true;
                                TERM.stdout.writenl("\0yellow(SKIP: Not updating transitive package at '" + node.path + "' as it is linked in from outside the program root.\0)");
                            }
                            return false;
                        }
                        if (parentLinked) {
                            if (!announced_updateOutdatedInSelectorTransitive_skipped[node.path]) {
                                announced_updateOutdatedInSelectorTransitive_skipped[node.path] = true;
                                TERM.stdout.writenl("\0yellow(SKIP: Not updating transitive package at '" + node.path + "' as parent '" + parentLinked.path + "' is linked in from outside the program root.\0)");
                            }
                            return false;
                        }
                        if (parentWriteMode) {
                            if (!announced_updateOutdatedInSelectorTransitive_skipped[node.path]) {
                                announced_updateOutdatedInSelectorTransitive_skipped[node.path] = true;
                                TERM.stdout.writenl("\0yellow(SKIP: Not updating transitive package at '" + node.path + "' as parent '" + parentLinked.path + "' is in write mode.\0)");
                            }
                            return false;
                        }
                        if (!outdated[node.level]) outdated[node.level] = [];
                        outdated[node.level].push(node);
                    }
                });
            }).then(function() {
                return outdated;
            });
        }

        return findOutdated().then(function(outdated) {
            if (UTIL.len(outdated) === 0) return;
            // Update outdated one level at a time, re-fetch status and find outdated again.
            outdated = outdated[Object.keys(outdated).shift()];
            var deferred = Q.defer();
            var waitFor = WAIT_FOR.makeParallel(function(err) {
                if (err) return deferred.reject(err);
                // Now repeat to get to deeper levels (current level nodes should no longer show up (as outdated) as we just updated them).
                updateOutdatedInSelectorTransitive(statusTree).then(deferred.resolve, deferred.reject);
            });
            outdated.forEach(function(node) {
                waitFor(function(done) {

                    if (!node.status.summary.newInSelectorLocation) {
                        throw new Error("Unable to update transitive package '" + node.path + "' as `newInSelectorLocation` not declared! Please report this issue.");
                    }

                    TERM.stdout.writenl("\0cyan(Updating transitive package '" + node.path + "' to: " + node.status.summary.newInSelectorLocation + "\0)");

                    PM.forPackagePath(node.path, pm).then(function(pm) {

                        var args = UTIL.copy(options);
                        args.pm = node.status.locator.pm;
                        args.locator = node.status.summary.newInSelectorLocation;
                        args.descriptorOverlay = node.status.locator.descriptorOverlay;
                        args.name = node.name;
                        args.force = true;

                        return pm.path(args).then(function(path) {

                            return Q.when(pm.install(args), function() {

                                if (!PATH.existsSync(PATH.join(path, ".sourcemint"))) {
                                    FS.mkdirSync(PATH.join(path, ".sourcemint"));
                                }
                                FS.writeFile(PATH.join(path, ".sourcemint", "source.json"), JSON.stringify({
                                    url: args.locator,
                                    nodeVersion: process.version,
                                    time: pm.context.time
                                }));
                            }).fail(function(err) {
                                if (node.parent) {
                                    err.message += " In package: " + node.parent.path;
                                }
                                return err;
                            });

                        }).then(function() {
                            return node.refresh({
                                now: true,
                                time: options.time,
                                verbose: options.verbose
                            }).then(function(changes) {
                                if (!changes || (node.status.summary.newInSelectorVersion || !node.status.summary.installed)) {

                                    TERM.stdout.writenl("\0red([sm] ERROR: " + "Updating transitive package '" + node.path + "' from '" + node.status.summary.version + "' to '" + node.status.summary.newInSelectorVersion + "' as triggered by 'newInSelectorVersion'!" + "\0)");
                                    TERM.stdout.writenl("\0red([sm] ERROR: " + "The package should be updated by now as we did everything we could to update it." + "\0)");
                                    TERM.stdout.writenl("\0red([sm] ERROR: " + "Check package to see if it is at latest version as desired. If it is then the sourcemint version check logic has a bug. Please report issue and provide details about version of package and which version is requested based on parent package dependency declaration." + "\0)");

                                    done(true); // Trigger error.
                                }
                            });
                        });
                    }).then(function() {
                        // Package was successfully updated to latest in selector range.
                        done();
                    }).fail(done);

                });
            });
            waitFor();
            return deferred.promise;
        });
    }
/*
    return Q.when(SM_STATUS.getStatusTree(pm, options), function(statusTree) {
        return updateOutdatedTopLevel(statusTree).then(function() {
            return updateOutdatedInSelectorTransitive(statusTree).then(function() {
                return updateRootLevel();
            });
        });
    });
*/

    options.all = true;

options.now = false;

    return CORE.getStatusTree(pm, options).then(function(statusTree) {

        var refreshNodes = [];

        return statusTree.forEachNode(function(node) {

            if (node.level === 0) {
                if (node.status.deepStatus.errors === false) {
                    var opts = UTIL.copy(options);
                    opts.all = false;
                    return SM_STATUS.printTree(statusTree, opts).then(function() {
                        return false;   // Don't traverse.
                    });
                } else
                if (options.command === "update" && node.status.deepStatus.dirty) {
                    var opts = UTIL.copy(options);
                    opts.all = false;
                    return SM_STATUS.printTree(statusTree, opts).fail(function(err) {
                        TERM.stdout.writenl("\0red(  ERROR: Cannot update! Fix \0bold(dirty\0) then re-run: \0bold(sm update\0)\0)");
                        TERM.stdout.writenl("");
                        throw err;
                    });
                }
                return true;    // Traverse deeper.
            }

            if (!node.status.status.newInVersion && node.status.status.installed) {
                // Nothing has changed so we don't need to update.
                return true;    // Traverse deeper.
            }

            if (node.status.status.symlinked === "inside") {
                // Skip as it is only a link.
                refreshNodes.push(node);
                return false;   // Don't traverse deeper.
            }

            if (node.status.inheritedStatus.symlinked === "outside") {
                TERM.stdout.writenl("\0yellow([sm] SKIP: Not updating '" + node.path + "' (parent linked in from outside program root)\0)");
                return false;   // Don't traverse deeper.
            }
            if (node.status.status.symlinked === "outside") {
                TERM.stdout.writenl("\0yellow([sm] SKIP: Not updating '" + node.path + "' (linked in from outside program root)\0)");
                return false;   // Don't traverse deeper.
            }

            if (node.status.inheritedStatus.vcs) {
                TERM.stdout.writenl("\0yellow([sm] SKIP: Not updating '" + node.path + "' (parent under version control)\0)");
                return false;   // Don't traverse deeper.
            }
            if (node.status.status.vcs) {
                TERM.stdout.writenl("\0yellow([sm] SKIP: Not updating '" + node.path + "' (under version control)\0)");
                return false;   // Don't traverse deeper.
            }

            return node.update(options);

        }).then(function() {
            var deferred = Q.defer();

            var waitFor = WAIT_FOR.makeParallel(function(err) {
                if (err) return deferred.reject(err);

                var opts = UTIL.copy(options);
                opts.all = false;
                SM_STATUS.printTree(statusTree, opts).then(deferred.resolve, deferred.reject);
            });

            refreshNodes.forEach(function(node) {
                waitFor(function(done) {
console.log("REFREH NODE", node.name);                    
                    node.refresh(options).then(done, done);
                });
            });
            waitFor();

            return deferred.promise;
        });
    });
}
