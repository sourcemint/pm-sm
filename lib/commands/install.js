
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


    options.all = true;

    return CORE.getStatusTree(pm, options).then(function(statusTree) {

        var rootPackagePath = null;
        var refreshNodes = [];

        return statusTree.forEachNode(function(node) {

            // Root package.
            if (node.level === 0) {
                rootPackagePath = node.path;
                if (node.status.deepStatus.errors === false) {
                    // Only show status info for root package.
                    if (rootPackagePath != pm.context.SM_PROGRAM_PACKAGE) {
                        return false;
                    }
                    var opts = UTIL.copy(options);
                    opts.all = false;
                    return SM_STATUS.printTree(statusTree, opts).then(function() {
                        return false;   // Don't traverse.
                    });
                } else
                if (options.command === "update" && node.status.deepStatus.dirty) {
                    // Only show status info for root package.
                    if (rootPackagePath != pm.context.SM_PROGRAM_PACKAGE) {
                        throw false;
                    }
                    var opts = UTIL.copy(options);
                    opts.command = "";
                    opts.all = false;
                    return SM_STATUS.printTree(statusTree, opts).fail(function(err) {
                        TERM.stdout.writenl("\0red(  ERROR: Cannot update! Fix \0bold(dirty\0) then re-run: \0bold(sm update\0)\0)");
                        TERM.stdout.writenl("");
                        throw err;
                    });
                }
                return true;    // Traverse deeper.
            }

            if ((
                    options.command === "update" && !node.status.status.newInVersion && node.status.status.installed
                ) || (
                    options.command === "install" && node.status.status.installed
                )) {
                // Nothing has changed so we don't need to update.
                return true;    // Traverse deeper.
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

                // Only show status info for root package.
                if (rootPackagePath != pm.context.SM_PROGRAM_PACKAGE) {
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
        });
    });
}
