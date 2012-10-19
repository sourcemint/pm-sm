
const UTIL = require("sourcemint-util-js/lib/util");
const Q = require("sourcemint-util-js/lib/q");
const TERM = require("sourcemint-util-js/lib/term");
const EXEC = require("child_process").exec;
const CORE = require("../core");


exports.main = function(pm, options) {
        
    if (options.git) {

        var opts = UTIL.copy(options);
        // Always set `all` to true so we get all dependencies in case there are errors deep down.
        opts.all = true;
        return CORE.getStatusTree(pm, opts).then(function(statusTree) {

            var opened = 0;

            return statusTree.forEachNode(function(node) {

                if (node.circular) return false;

                if (options.dirty) {
                    if (node.status.status.git && node.status.status.git.dirty) {

                        TERM.stdout.writenl("\0cyan(Calling: " + "stree " + node.path + "\0)");

                        var deferred = Q.defer();
                        // TODO: Make command configurable via ~/.sourcemint/config.json
                        EXEC("stree " + node.path, function(error, stdout, stderr) {
                            if (error || stderr) {
                                return deferred.reject(new Error("Error opening package with `stree`: " + stderr));
                            }
                            opened += 1;
                            deferred.resolve();
                        });
                        return deferred.promise;
                    }
                }

            }).then(function() {
                if (opened === 0) {
                    if (options.dirty) {
                        TERM.stdout.writenl("\0yellow(No \0red([\0bold(git dirty\0)]\0) packages found! See `sm status`.\0)");
                    } else {
                        TERM.stdout.writenl("\0yellow(No \0red([\0bold(git\0)]\0) packages found! See `sm status`.\0)");
                    }
                    TERM.stdout.writenl("\0yellow(Looks like you are ready to `sm -h bump` or `sm -h publish`?\0)");
                } else {
                    TERM.stdout.writenl("\0green(Opened \0bold(" + opened + "\0) package" + ((opened > 1)?"s":"") + ".\0)");
                }                
            });
        });

    } else {
        TERM.stdout.writenl("\0red(Error: Must specify --git (others to come)\0)");
        var deferred = Q.defer();
        deferred.reject();
        return deferred.promise;
    }
}
