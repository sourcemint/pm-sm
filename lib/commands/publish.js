
var ASSERT = require("assert");
var PATH = require("path");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var GIT = require("sourcemint-pm-git/lib/git");
var PM_NPM = require("sourcemint-pm-npm/lib/pm");
var SEMVER = require("semver");
var SM_PM = require("../pm");



exports.main = function(pm, options) {

    if (options.pm) {
        return require("sourcemint-pm-" + options.pm + "/lib/pm").publish(pm, options);
    }


    var packagePath = pm.context.package.path;

    var git = GIT.interfaceForPath(packagePath);
    
    return git.status().then(function(status) {

        var done = Q.ref();
        
        if (status.type === "git") {
            if (status.dirty === true) {
                TERM.stderr.writenl("\0red(\0bold(ERROR: Cannot publish as git is dirty!\0)\0)");
                return;
            }

            if (status.tagged !== "v" + pm.context.package.descriptor.json.version) {
                TERM.stderr.writenl("\0red(\0bold(ERROR: Cannot publish as latest GIT tag does not match 'v" + pm.context.package.descriptor.json.version + "' based on version from package descriptor '" + pm.context.package.descriptor.path + "'!\0)\0)");
                return;
            }

            done = Q.when(done, function() {
                return git.push({
                    tags: true,
                    branch: status.branch,
                    remote: "origin"
                }).then(function() {
                    TERM.stdout.writenl("\0green(Pushed git branch '" + status.branch + "' of package '" + pm.context.package.path + "' to remote '" + "origin" + "'.\0)");
                });
            });
        }

        if (pm.context.package.descriptor.json.pm === "npm") {
            done = Q.when(done, function() {
                return SM_PM.forPackagePath(packagePath, pm).then(function(pm) {

                    var opts = UTIL.copy(options);
                    opts.pm = "npm";

                    return pm.publish(opts);
                });
            });
        }

        return done;
    });
}
