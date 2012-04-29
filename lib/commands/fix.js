
var ASSERT = require("assert");
var PATH = require("path");
var FS = require("fs");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var TERM = require("sourcemint-util-js/lib/term");
var EXEC = require("child_process").exec;
var PACKAGES = require("sourcemint-pinf-js/lib/packages");
var SM_PM = require("sourcemint-pm-sm/lib/pm");


exports.main = function(pm, options) {
        
    if (options.git) {

        return PACKAGES.loadDependenciesForProgram(pm.context.program).then(function() {

            return pm.context.program.walkPackages({}, function(parentPkg, pkgInfo, pkgContext) {
                
                if (pkgContext.circular === true) return;

                return SM_PM.forPackagePath(pkgInfo[0].path, pm).then(function(pm) {
                    var opts = UTIL.copy(options);
                    opts.pm = "git";
                    return pm.status(opts).then(function(status) {
                        if (status.type === "git") {
                            var show = false;
                            if (options.dirty === true) {
                                if (status.dirty === true) {
                                    show = true;
                                }
                            } else {
                                if (status.ahead || status.remoteAhead) {
                                    show = true;
                                }
                            }
                            if (show) {
                                var deferred = Q.defer();
                                // TODO: Make command configurable via ~/.sourcemint/config.json
                                EXEC("stree " + pm.context.package.path, function(err, stdout, stderr) {
                                    if (err) {
                                        deferred.reject(err);
                                        return;
                                    }
                                    deferred.resolve();
                                });
                                return deferred.promise;
                            }
                        }
                    });
                });
            });
        });

    } else {
        TERM.stdout.writenl("\0red(Error: Must specify --git (others to come)\0)");
        var deferred = Q.defer();
        deferred.reject();
        return deferred.promise;
    }
}
