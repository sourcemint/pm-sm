
var PATH = require("path");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var GIT = require("sourcemint-pm-git/lib/git");
var SEMVER = require("semver");
var SM_PM = require("../pm");



exports.main = function(pm, options) {

    var packagePath = pm.context.program.package.path;

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
        
        var version = pm.context.program.package.descriptor.json.version;
        if (!version) {
            TERM.stderr.writenl("\0red(\0bold(ERROR: No 'version' property found in package descriptor '" + pm.context.program.package.descriptor.path + "'!\0)\0)");
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
            message = "\0green(Bumped patch segment of '" + version + "' to '" + newVersion + "'.\0)";
        }
        else if (options.minor) {
            newVersion = version.split(".");
            if (parseInt(newVersion[1]) != newVersion[1]) {
                throw new Error("Cannot bump non-numeric version segments yet!");
            }
            newVersion[1] = parseInt(newVersion[1]) + 1;
            newVersion[2] = 0;
            newVersion = newVersion.join(".");
            message = "\0green(Bumped minor segment of '" + version + "' to '" + newVersion + "'.\0)";
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
            message = "\0green(Bumped major segment of '" + version + "' to '" + newVersion + "'.\0)";
        }

        pm.context.program.package.descriptor.json.version = newVersion;

        return pm.context.program.package.descriptor.write().then(function() {
            return git.commit("bump package version to v" + newVersion, {
                add: true
            }).then(function() {
                return git.tag("v" + newVersion).then(function() {
                    TERM.stdout.writenl(message);
                });
            });
        });
    }).then(function(bumped) {
        if (bumped === false) return;
        var done = Q.ref();
        if (options.publish) {
            done = Q.when(done, function() {
                return pm.publish(options);
            });
        }
        return done;
    });
}
