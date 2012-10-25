
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

    ASSERT(typeof pm.context.program !== "undefined", "'context.program' required!");

    options.all = true;

    // Check if our package is dirty. We cannot update if it is.
    return GIT.interfaceForPath(pm.context.program.package.path, {
        verbose: options.debug
    }).status().then(function(gitStatus) {
        if (options.update && gitStatus && gitStatus.dirty) {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("\0red([sm] ERROR: Cannot " + options.command + "! Git repository is \0bold(dirty\0). You need to commit your changes and then re-run: \0bold(sm " + options.command + "\0)\0)");
            TERM.stdout.writenl("");
            throw true;
        }
    }).then(function() {

        return CORE.getStatusTree(pm, options).then(function(statusTree) {

            var rootPackage = null;
            var refreshNodes = [];
            var selector = null;
            if ((options.command === "install" || options.command === "update") && options.args && options.args.length === 2) {
                selector = options.args[1];
            }

            var manifest = {};

            return statusTree.forEachNode(function(node) {

                // Root package.
                if (node.level === 0) {
                    rootPackage = node;
                    return true;    // Traverse deeper.
                }

                // TODO: Add deeper packages as well?
                if (node.level === 1) {
                    manifest[node.name] = node.status;
                }

                if (selector) {
                    if (node.name !== selector && node.status.status.relpath !== selector) {
                        return true;
                    }
                }

                if (options.update) {
                    // We are updating.
                    if (!node.status.status.newInVersion && !node.status.status.newInLocator && node.status.status.installed) {
                        // Nothing has changed so we don't need to update.
                        return true;    // Traverse deeper.
                    }
                }
                if (!options.update) {
                    // We are installing.
                    if (node.status.status.installed) {
                        // Package is installed.
                        return true;    // Traverse deeper.
                    }
                }

                if (node.status.status.symlinked === "inside") {
                    // Skip as it is only a link but refresh status when all traversing is done to resolve link status.
                    refreshNodes.push(node);
                    return false;   // Don't traverse deeper.
                }
                if (node.status.summary && node.status.summary.inParent) {
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

                return node.update(options).then(function() {
                    return true;
                });

            }).then(function() {

                if (options.postinstall === false) return;

                if (rootPackage.status.descriptor.pm === "sm") {
                    if (options.quiet !== true) TERM.stdout.writenl("\0cyan([sm] Running postinstall for '" + rootPackage.path + "' (npm run-script postinstall).\0)");
                    return NPM.runScript(rootPackage.path, "postinstall", {
                        verbose: options.verbose
                    });
                } else {
                    // Assuming `pm === "npm"`.
                    if (options.quiet !== true) TERM.stdout.writenl("\0cyan([sm] Running postinstall for '" + rootPackage.path + "' (npm install).\0)");
                    return NPM.install(rootPackage.path, ".", {
                        verbose: options.verbose
                    });
                }

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

                    var opts = UTIL.copy(options);
                    opts.all = false;
                    SM_STATUS.printTree(statusTree, opts).then(deferred.resolve, deferred.reject);
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
