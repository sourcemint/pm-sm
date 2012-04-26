
var PATH = require("path");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var GIT = require("sourcemint-pm-git/lib/git");
var NPM = require("sourcemint-pm-npm/lib/npm");
var SEMVER = require("semver");
var SM_PM = require("../pm");



exports.main = function(pm, options) {

    var packagePath = pm.context.program.package.path;

    var git = GIT.interfaceForPath(packagePath);
    
    return git.status().then(function(status) {

        var done = Q.ref();
        
        if (status.type === "git") {
            if (status.dirty === true) {
                TERM.stderr.writenl("\0red(\0bold(ERROR: Cannot publish as git is dirty!\0)\0)");
                return;
            }
            done = Q.when(done, function() {
                return git.push({
                    tags: true,
                    branch: status.branch,
                    remote: "origin"
                }).then(function() {
                    TERM.stdout.writenl("\0green(Pushed git branch '" + status.branch + "' to remote '" + "origin" + "'.\0)");
                });
            });
        }

        if (pm.context.program.package.descriptor.json.pm === "npm") {
            if (pm.context.program.package.descriptor.json.private !== true) {
                done = Q.when(done, function() {
                    
                    // TODO: Only publish package if last commit == tag == latest version.

                    return NPM.publish(packagePath);                    
                });
            }
        }

        return done;
    });
}
