
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const EXEC = require("child_process").exec;
const Q = require("sourcemint-util-js/lib/q");
const TERM = require("sourcemint-util-js/lib/term");
const UTIL = require("sourcemint-util-js/lib/util");
const PACKAGES = require("sourcemint-pinf-js/lib/packages");
const PM = require("../pm");
const NPM = require("sourcemint-pm-npm/lib/npm");
const URI_PARSER = require("../uri-parser");


exports.main = function(pm, options) {
    var self = this;

    if (pm.context.package && pm.context.program) {
        
        if (pm.context.package.path.substring(0, pm.context.program.package.path.length) != pm.context.program.package.path &&
            pm.context.package.path.substring(0, pm.context.homeBasePath.length) != pm.context.homeBasePath) {

            TERM.stdout.writenl("\0yellow(SKIP: Not installing new package at '" + pm.context.package.path + "' as path is outside of program root '" + pm.context.program.package.path + "'.\0)");

            return Q.ref();
        }
    }
    
    if (options.pm) {
        return require("sourcemint-pm-" + options.pm + "/lib/pm").install(pm, options);
    }
    
    ASSERT(typeof pm.context.program !== "undefined", "'context.program' required!");

    return PACKAGES.loadDependenciesForProgram(pm.context.program).then(function() {

        var done = Q.ref();
        // NOTE: By default we expect a NPM-compatible package unless otherwise specified.
        var pmDeclaration = pm.context.program.package.descriptor.pm;
        if (typeof pmDeclaration === "undefined" || pmDeclaration === "npm") {
            done = Q.when(done, function() {
                var opts = {
                    env: {
                        "SM_CLI_CALL": "true"
                    }
                };
                if (options.update === true) {
                    return NPM.update(pm.context.program.package.path, opts);
                } else {
                    return NPM.install(pm.context.program.package.path, ".", opts);
                }
            });
        }

        return done.then(function() {
            return pm.context.program.walkPackages({}, function(parentPkg, pkgInfo, pkgContext) {
                
                if (!parentPkg) {
                    // We are in the parent package.
                    
                    
                    // TODO: Git pull if git not dirty or ahead.
                    return;
                }
                if (pkgContext.circular === true) return;

                var mapping = false;

                if (pkgInfo[1].indexOf("mappings") >= 0) {
                    mapping = parentPkg.descriptor.json.mappings[pkgInfo[2][0]];
                }
                else if (pkgInfo[1].indexOf("devMappings") >= 0) {
                    mapping = parentPkg.descriptor.json.devMappings[pkgInfo[2][0]];
                }
                
                function walkMappings() {

                    if (!mapping) {
                        return;
                    }
                        
                    if (mapping === ".") {
                            
    throw new Error("NYI - Mapping to self!");                        
                        
                    } else {

                        return PM.forPackagePath(pkgInfo[0].path, pm).then(function(pm) {
                            
                            var args = UTIL.copy(options);
                            args.pm = mapping[0];
                            args.locator = mapping[1];
                            args.name = PATH.basename(pm.context.package.path);

                            return pm.path(args).then(function(path) {

                                var deferred = Q.defer();

                                function install(force) {

                                    if (force === true) {
                                        args.force = true;
                                    }

                                    Q.when(pm[(args.update === true)?"update":"install"](args), function() {
                                        
                                        if (!PATH.existsSync(PATH.join(path, ".sourcemint"))) {
                                            FS.mkdirSync(PATH.join(path, ".sourcemint"), 0755);
                                        }
                                        FS.writeFile(PATH.join(path, ".sourcemint", "source.json"), JSON.stringify({
                                            url: args.locator,
                                            nodeVersion: process.version,
                                            time: pm.context.time
                                        }), function(err) {
                                            if (err) {
                                                deferred.reject(err);
                                                return;
                                            }
                                            deferred.resolve(true);
                                        });
                                    }, deferred.reject);
                                }
                                
                                PATH.exists(PATH.join(path, ".sourcemint", "source.json"), function(exists) {
                                    if (exists) {
                                        // Already exists.
                                        FS.readFile(PATH.join(path, ".sourcemint", "source.json"), function(err, data) {
                                            if (err) {
                                                deferred.reject(err);
                                                return;
                                            }
                                            var sourceInfo = JSON.parse(data);
                                            if (sourceInfo.url === args.locator && sourceInfo.nodeVersion === process.version) {
                                                // No change.
                                                if (options.update === true) {
                                                    install();
                                                    return;
                                                }
                                                deferred.resolve();
                                                return;
                                            }
                                            install(true);
                                        });
                                        return;
                                    }
                                    install(true);
                                });
    
                                return deferred.promise;
                            });
                        });                     
                    }
                }
                
                function walkDependencies() {
                    var dependency = false;

                    if (pkgInfo[1].indexOf("dependencies") >= 0) {
                        dependency = parentPkg.descriptor.json.dependencies[pkgInfo[2][0]];
                    }
                    else if (pkgInfo[1].indexOf("devDependencies") >= 0) {
                        dependency = parentPkg.descriptor.json.devDependencies[pkgInfo[2][0]];
                    }

                    if (!dependency) {
                        return;
                    }

//console.log(pkgInfo[2][0], dependency, pkgInfo[0].path);

                }
                
                return PM.forPackagePath(pkgInfo[0].path, pm).then(function(pm) {
                    return pm.status({
                        "pm": "git"
                    });
                }).then(function(gitStatus) {

                    if (gitStatus.type === "git") {
                        TERM.stdout.writenl("\0yellow(SKIP: Not updating package at '" + pkgInfo[0].path + "' as it is in write mode (git repository present).\0)");
                        return;
                    }

                    return Q.when(walkMappings(), function() {
                        return Q.when(walkDependencies());
                    });
                });
            });
        });
    }); 
}
