
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

    options = options || {};

    if (!process.env["SM_CLI_CALL"]) {
        options.dev = true;
    }

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

    // TODO: Attach this to `pm.context`?
    var manifest = {};

    return PACKAGES.loadDependenciesForProgram(pm.context.program).then(function() {

        var done = Q.ref();
        // NOTE: By default we expect a NPM-compatible package unless otherwise specified.
        var pmDeclaration = pm.context.program.package.descriptor.pm;
        if (options.descriptorOverlay && typeof options.descriptorOverlay.pm !== "undefined") {
            pmDeclaration = options.descriptorOverlay.pm;
        }
        if (pmDeclaration !== false && (typeof pmDeclaration === "undefined" || pmDeclaration === "npm") && options["no-native-install"] !== true) {
            done = Q.when(done, function() {
                var opts = {
                    env: {
                        "SM_CLI_CALL": "true"
                    },
                    verbose: options.verbose,
                    dev: options.dev || false
                };
                if (options.update === true) {
                    if (options.latest === true) {
                        return NPM.install(pm.context.program.package.path, ".", opts).then(function() {
                            return NPM.update(pm.context.program.package.path, opts);
                        });
                    } else {
                        return NPM.install(pm.context.program.package.path, ".", opts);
                    }
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
                var alias = false;

                if (pkgInfo[1].indexOf("mappings") >= 0) {
                    alias = pkgInfo[2][0];
                    mapping = parentPkg.descriptor.json.mappings[alias];
                }
                else if (pkgInfo[1].indexOf("devMappings") >= 0) {
                    alias = pkgInfo[2][0];
                    mapping = parentPkg.descriptor.json.devMappings[alias];
                }

                var libDir = "lib";
                if (pkgInfo[0].descriptor.json.directories && typeof pkgInfo[0].descriptor.json.directories.lib !== "undefined") {
                    libDir = pkgInfo[0].descriptor.json.directories.lib;
                }

                if (options.latest !== true && options.update !== true && PATH.existsSync(pkgInfo[0].path)) {
                    // If found we skip as we are not asked to update.
                    if (PATH.existsSync(pkgInfo[0].path)) {
                        manifest[alias] = {
                            path: pkgInfo[0].path,
                            libDir: libDir
                        };
                        return false;
                    }
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
                            args.descriptorOverlay = mapping[2] || false;
                            args.name = PATH.basename(pm.context.package.path);

                            return pm.path(args).then(function(path) {

                                manifest[alias] = {
                                    path: path,
                                    libDir: libDir
                                };

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
                                    }, function(err) {
                                        if (parentPkg) {
                                            err.message += " In package: " + parentPkg.path;
                                        }
                                        deferred.reject(err);
                                    });
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
                        "pm": "git",
                        verbose: options.verbose
                    });
                }).then(function(gitStatus) {

                    if (pkgInfo[0].path.substring(0, pm.context.program.package.path.length) != pm.context.program.package.path &&
                        pkgInfo[0].path.substring(0, pm.context.homeBasePath.length) != pm.context.homeBasePath) {

                        if (gitStatus.type === "git") {
                            TERM.stdout.writenl("\0yellow(SKIP: Not updating package at '" + pkgInfo[0].path + "' as it is linked in from outside the program root (git[" + gitStatus.rev + "] repository present).\0)");
                        } else {
                            TERM.stdout.writenl("\0yellow(SKIP: Not updating package at '" + pkgInfo[0].path + "' as it is linked in from outside the program root.\0)");
                        }
                        // Package is outside if program package so we don't update it.
                        return false;
                    }

                    if (gitStatus.type === "git") {
                        TERM.stdout.writenl("\0yellow(SKIP: Not updating package at '" + pkgInfo[0].path + "' as it is in write mode (git[" + gitStatus.rev + "] repository present).\0)");
                        return false;
                    }

                    return Q.when(walkMappings(), function() {
                        return Q.when(walkDependencies());
                    });
                });
            });
        });
    }).then(function() {
        return manifest;
    }); 
}
