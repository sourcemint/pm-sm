
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
const GIT = require("sourcemint-pm-git/lib/git");
const URI_PARSER = require("../uri-parser");
const SM_STATUS = require("./status");
const CORE = require("../core");


exports.main = function(pm, options) {
    var self = this;

    options = options || {};
/*
    if (pm.context.package && pm.context.program) {
        
        if (pm.context.package.path.substring(0, pm.context.program.package.path.length) != pm.context.program.package.path &&
            pm.context.package.path.substring(0, pm.context.homeBasePath.length) != pm.context.homeBasePath) {

            TERM.stdout.writenl("\0yellow(SKIP: Not installing new package at '" + pm.context.package.path + "' as path is outside of program root '" + pm.context.program.package.path + "'.\0)");

            return Q.ref();
        }
    }
*/

    // TODO: Do we still need this?
/*    
    if (typeof options.descriptorOverlay !== "undefined") {
        if (typeof options.descriptorOverlay.pm === "undefined") {
            options.descriptorOverlay.pm = false;
        }
        UTIL.deepUpdate(pm.context.program.package.descriptor.json, options.descriptorOverlay);
    }
*/
/*
    if (options.pm) {

        if (options.locator) {

            // See if we need to force a clone based on URI provided in mapping.
            // If mapping is a private URI we need to clone, otherwise we can just download archive.

            var parsedLocator = URI_PARSER.parse(options.locator);
            if (parsedLocator.originalLocatorPM === "git-write") {
                delete options.name;
                options.locator = parsedLocator.locators["git-write"] + "#" + parsedLocator.vendor.rev;
                options.forceClone = true;
            }
        }

        return require("sourcemint-pm-" + options.pm + "/lib/pm").install(pm, options);
    }
*/

    ASSERT(typeof pm.context.program !== "undefined", "'context.program' required!");

    options.all = true;

    // Check if our package is dirty. We cannot update if it is.
    var opts = UTIL.copy(options);
    opts.now = false;
    opts.levels = 0;
    return CORE.getStatusTree(pm, opts).then(function(statusTree) {
        function fail(message) {
            TERM.stdout.writenl("");
            TERM.stdout.writenl(message);
            TERM.stdout.writenl("");
            throw true;
        }
        if (statusTree.status["npm-shrinkwrap"] && options.update) {
            fail("\0red([sm] ERROR: You cannot `sm update` a package that contains a npm-shrinkwrap.json file. Remove '" + PATH.join(statusTree.path, "npm-shrinkwrap.json") + "' and set `catalog: true` in '" + PATH.join(statusTree.path, "package.json") + "' to maintain sticky dependencies via `sm update`.\0)");
        } else
        if (statusTree.status.git && statusTree.status.git.dirty && options.update) {
            if (statusTree.status["sm-catalog"]) {
                fail("\0red([sm] ERROR: Cannot update package with sm-catalog.json file if git repository is \0bold(dirty\0). You need to commit your changes and then run: \0bold(sm update\0)\0)");
            } else
            if (statusTree.status["sm-catalog-locked"]) {
                fail("\0red([sm] ERROR: Cannot update package with sm-catalog.locked.json file if git repository is \0bold(dirty\0). You need to commit your changes and then run: \0bold(sm update\0)\0)");
            }
        }
    }).then(function() {
        return CORE.getStatusTree(pm, options).then(function(statusTree) {
            var rootPackage = null;
            var refreshNodes = [];
            var selector = false;
//            if ((options.command === "install" || options.command === "update") && options.args && options.args.length === 2) {
            if (options.command === "update" && options.args && options.args.length > 0) {
                selector = options.args;
                selector[0] = selector[0].replace(/\/$/, "");
            }
            // Treat `selector[1]` as pointer.

            var didMakeChanges = false;

            var manifest = {};
            var notices = [];

            function nodeWorker(node) {

                // Top-level package.
                if (node.level === 0) {
                    rootPackage = node;
                    return true;    // Traverse deeper.
                }

                // TODO: Add deeper packages as well?
                if (node.level === 1) {
                    manifest[node.name] = node.status.status;
                }

                if (selector) {
                    if (node.name !== selector[0] && node.status.status.relpath !== selector[0]) {
                        // If selector provided and it does not match we don't check node.
                        return true;
                    }
                }

                if (options.update) {
                    // We are updating.
                    if (node.status.status.mustInstall || node.status.status.mustUpdate) {
                        // We must update.
                    } else
                    if (node.status.status.canUpdate) {
                        // We update because an update was requested and we have something to optionally update.
                        // TODO: Get rid of the `canUpdate` and `mustUpdate` distinction.
console.log("Update triggered because of `canUpdate` for node: " + node.name);
                    } else
                    if (selector) {
                        // `selector[0]` may be a relpath so we ensure its just the name.
                        selector[0] = node.name;
                        // We update because an update was specifically requested for us.
                        if (selector.length === 1 && node.status.status.newOutLocator) {
                            // NOTE: We always have a `version` here as there would be no new out locator if
                            //       proper versioning with a * selector was not in play for this node.
                            if (node.status.status.newOutLocator.version === false || node.status.status.newOutLocator.selector !== "*") {
                                throw new Error("Unable to determine new version for selector!");
                            }
                            selector.push(node.status.status.newOutLocator.version);
                        }
                        // If new selector matches existing selector we skip. We get here if selector CLI arg matches existing locator.selector or
                        // after `updateDependencyTo()` is called below.
                        if (selector[1] === node.status.status.locator.selector) {
                            return true;    // Traverse deeper.
                        }
                    } else {
                        return true;    // Traverse deeper.
                    }
                }
                if (!options.update) {
                    // We are installing.
                    if (node.status.status.mustInstall) {
                        // We must install.
                    } else {
                        return true;    // Traverse deeper.
                    }
                }

                if (node.status.status.symlinked === "inside") {
                    // Skip as it is only a link but refresh status when all traversing is done to resolve link status.
                    refreshNodes.push(node);
                    return false;   // Don't traverse deeper.
                }
                if (node.status.status.inParent) {
                    // Skip as parent will deal with node.
                    return false;
                }

                if (node.status.inheritedStatus.symlinked === "outside") {
                    if (options.quiet !== true) TERM.stdout.writenl("\0yellow([sm] SKIP: Not " + options.command.replace(/e$/, "") + "ing '" + node.status.status.relpath + "' (parent linked in from outside program root)\0)");
                    return false;   // Don't traverse deeper.
                }
                if (node.status.status.symlinked === "outside") {
                    if (options.quiet !== true) TERM.stdout.writenl("\0yellow([sm] SKIP: Not " + options.command.replace(/e$/, "") + "ing '" + node.status.status.relpath + "' (linked in from outside program root)\0)");
                    return false;   // Don't traverse deeper.
                }

                if (node.status.inheritedStatus.vcs) {
                    if (options.quiet !== true) TERM.stdout.writenl("\0yellow([sm] SKIP: Not " + options.command.replace(/e$/, "") + "ing '" + node.status.status.relpath + "' (parent under version control)\0)");
                    return false;   // Don't traverse deeper.
                }
                if (node.status.status.vcs) {
                    if (options.quiet !== true) TERM.stdout.writenl("\0yellow([sm] SKIP: Not " + options.command.replace(/e$/, "") + "ing '" + node.status.status.relpath + "' (under version control)\0)");
                    return false;   // Don't traverse deeper.
                }

                didMakeChanges = true;

                if (selector) {

                    if (node.level > 1) {
                        TERM.stdout.writenl("\0yellow([sm] SKIP: Not updating selector for '" + node.path + "' to '" + selector[1] + "' as it is a transitive package and no sm-catalog.locked.json file is present!\0)");
                        return true;
                    } else {
                        var originalSelector = selector;
                        return node.parent.updateDependencyTo(selector[0], selector[1], options).then(function() {
                            // Reset `selector` so all children will be checked.
                            selector = false;
                            return node.parent.forEachReadyNodeRecursive(nodeWorker);
                        }).then(function() {
                            // Now that all children have been checked we put selector back to ensure only other matching packages get updated.
                            selector = originalSelector;
                            return true;
                        });
                    }
                } else {
                    return node.update(options).then(function() {
                        return true;
                    });
                }
            }

            return statusTree.forEachReadyNodeRecursive(nodeWorker).then(function() {

                if (!didMakeChanges && selector) {
                    TERM.stdout.writenl("");
                    TERM.stdout.writenl("\0red([sm] ERROR: Did not find any matching packages for selector '" + selector[0] + "'!\0)");
                    TERM.stdout.writenl("");
                    throw true;
                }

                if (didMakeChanges || rootPackage.package.newPlatformVersion) {
                    // Assuming everything is up to date.
                    return rootPackage.package.postinstall(options).then(function() {
                        return rootPackage.refresh(options);
                    });
/*
                    if (rootPackage.status.deepStatus.mustInstall || rootPackage.status.deepStatus.mustUpdate) {
                        if (options.quiet !== true) TERM.stdout.writenl("\0yellow([sm] SKIP: Not running postinstall for '" + rootPackage.path + "' as there are still out-of-date dependencies.\0)");
                    } else {
                    }
*/
                }

            }).then(function() {

                return rootPackage.stickies.save().then(function() {
                    if (rootPackage.stickies.saved) {
                        notices.push("\0cyan(  Updated '" + rootPackage.stickies.path + "'. \0bold(You need to commit this!\0)\0)");
                    }
                });

            }).then(function() {
                var deferred = Q.defer();

                var waitFor = WAIT_FOR.makeParallel(function(err) {
                    if (err) return deferred.reject(err);

                    if (options.quiet === true) {
                        return deferred.resolve();
                    }

                    // Only show status info for root package.
                    if (rootPackage.path != pm.context.SM_PROGRAM_PACKAGE) {
                        return deferred.resolve();
                    }

                    if (didMakeChanges) {
                        TERM.stdout.writenl("\n\0bold(Status after " + options.command + ":\0)");
                    }

                    var opts = UTIL.copy(options);
                    opts.all = false;
                    SM_STATUS.printTree(statusTree, opts).then(function() {
                        if (notices.length > 0) {
                            notices.forEach(TERM.stdout.writenl);
                            TERM.stdout.writenl("");
                        }
                    }).then(deferred.resolve, deferred.reject);
                });

                refreshNodes.forEach(function(node) {
                    waitFor(function(done) {
                        node.refresh(options).then(done, done);
                    });
                });
                waitFor();

                return deferred.promise;
            }).then(function() {
                return manifest;
            });
        });
    });
}
