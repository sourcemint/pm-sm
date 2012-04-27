
var PATH = require("path");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var GIT = require("sourcemint-pm-git/lib/git");
var SEMVER = require("semver");
var SM_PM = require("../pm");
var PACKAGES = require("sourcemint-pinf-js/lib/packages");



exports.main = function(pm, options) {

    var packagePath = pm.context.package.path;

    var git = GIT.interfaceForPath(packagePath);
    
    return git.status().then(function(status) {

        if (status.type !== "git") {
            TERM.stderr.writenl("\0red(\0bold(ERROR: Cannot bump non-git repositories yet!\0)\0)");
            return false;
        }
        if (status.dirty === true) {
            TERM.stderr.writenl("\0red(\0bold(ERROR: Cannot bump as git is dirty!\0)\0)");
            return false;
        }
        
        var version = pm.context.package.descriptor.json.version;
        if (!version) {
            TERM.stderr.writenl("\0red(\0bold(ERROR: No 'version' property found in package descriptor '" + pm.context.package.descriptor.path + "'!\0)\0)");
            return false;
        }

        var message = false;
        var newVersion = false;

        if (options.patch) {
            newVersion = version.split(".");
            if (parseInt(newVersion[2]) != newVersion[2]) {
                throw new Error("Cannot bump non-numeric version segments yet!");
            }
            newVersion[2] = parseInt(newVersion[2]) + 1;
            newVersion = newVersion.join(".");
            message = "\0green(Bumped patch segment of '" + version + "' to '" + newVersion + "' in package descriptor '" + pm.context.package.descriptor.path + "'.\0)";
        }
        else if (options.minor) {
            newVersion = version.split(".");
            if (parseInt(newVersion[1]) != newVersion[1]) {
                throw new Error("Cannot bump non-numeric version segments yet!");
            }
            newVersion[1] = parseInt(newVersion[1]) + 1;
            newVersion[2] = 0;
            newVersion = newVersion.join(".");
            message = "\0green(Bumped minor segment of '" + version + "' to '" + newVersion + "' in package descriptor '" + pm.context.package.descriptor.path + "'.\0)";
        }
        else if(options.major) {
            newVersion = version.split(".");
            if (parseInt(newVersion[0]) != newVersion[0]) {
                throw new Error("Cannot bump non-numeric version segments yet!");
            }
            newVersion[0] = parseInt(newVersion[0]) + 1;
            newVersion[1] = 0;
            newVersion[2] = 0;
            newVersion = newVersion.join(".");
            message = "\0green(Bumped major segment of '" + version + "' to '" + newVersion + "' in package descriptor '" + pm.context.package.descriptor.path + "'.\0)";
        }

        pm.context.package.descriptor.json.version = newVersion;

        return pm.context.package.descriptor.write().then(function() {
            
            var tag = "v" + newVersion;

            message = "\0green(Committed version change and tagged package '" + pm.context.package.path + "' (on branch '" + status.branch + "') with tag '" + tag + "'.\0)";

            return git.commit("bump package version to v" + newVersion, {
                add: true
            }).then(function() {
                return git.tag(tag).then(function() {
                    TERM.stdout.writenl(message);
                });
            });
        });
    }).then(function(bumped) {
        if (bumped === false) return;
        var done = Q.ref();
        if (options.publish) {
            done = Q.when(done, function() {
                return pm.publish();
            });
        }
        return done;
    }).then(function() {
        if (options.recursive === true) {
            return PACKAGES.loadDependenciesForProgram(pm.context.program).then(function() {
                return pm.context.program.walkPackages(options, function(parentPkg, pkgInfo, context) {
                    return SM_PM.forPackagePath(pkgInfo[0].path, pm).then(function(pm) {
                        var opts = {};
                        opts.pm = "git";
                        return pm.status(opts).then(function(status) {
                            if (status.type === "git") {
                                if (status.dirty === false && status.remoteAhead !== false && !status.tagged) {
                                    var opts = UTIL.copy(options);
                                    opts.recursive = false;
                                    return pm.bump(options);
                                }
                            }
                        });
                    });
                });
            });
        }
    });
}
