
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const EXEC = require("child_process").exec;
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const PROGRAM = require("sourcemint-pinf-js/lib/program");
const PACKAGE = require("sourcemint-pinf-js/lib/package");
const FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");
const CREDENTIALS = require("sourcemint-credentials-js/lib/credentials");
const JSON_STORE = require("sourcemint-util-js/lib/json-store").JsonStore;


exports.forProgramPath = function(programPath, owningPM) {
    var pm = new PM();
    return pm.initForProgramPath(programPath, owningPM).then(function() {
        return pm;
    });
}

exports.forPackagePath = function(packagePath, parentPM) {
    var pm = new PM();
    return pm.initForPackagePath(packagePath, parentPM).then(function() {
        return pm;
    });
}


var PM = function() {

    ASSERT(typeof process.env.HOME !== "undefined", "'HOME' environment variable must be set!");

    this.context = {
        time: new Date().getTime(),
        homeBasePath: PATH.join(process.env.HOME, ".sourcemint")
    };

    this.context.credentials = CREDENTIALS.Credentials("default", {
        dirname: this.context.homeBasePath,
        adapter: "file-json"
    });
}

PM.prototype.initForProgramPath = function(programPath, owningPM) {
    var self = this;
    return Q.call(function() {
        self.context.program = new PROGRAM.Program();
        return self.context.program.initForPath(programPath).then(function() {
            // TODO: Rename '.sourcemint' to '.pinf' once standardized.
            self.context.metaBasePath = PATH.join(PATH.dirname(self.context.program.path), ".sourcemint");
// TODO: The `<target>.program.json` file should be used when deplying to a given `--target <target>`.
//       If no `--target` specified the `program.local.json` file is used.
//            self.context.deployment = DESRIPTOR from self.context.program.descriptor.path.replace(/(\.json$)/, "." + target + "$1");
            self.context.deploymentDescriptor = self.context.program.runtimeDescriptor;


            // Load different credentials file if configured to do so in program.
            if (owningPM) {
                self.context.credentials = owningPM.context.credentials;
            }
            else {
                if (self.context.program.descriptor.json.config &&
                    self.context.program.descriptor.json.config["github.com/sourcemint/profile/0"] &&
                    self.context.program.descriptor.json.config["github.com/sourcemint/profile/0"].name
                ) {
                    var path = PATH.join(
                        self.context.homeBasePath,
                        self.context.program.descriptor.json.config["github.com/sourcemint/profile/0"].name
                    );
                    if (!PATH.existsSync(path)) {
                        FS.mkdirSync(path);
                    }
                    self.context.credentials = CREDENTIALS.Credentials(self.context.program.descriptor.json.config["github.com/sourcemint/profile/0"].name, {
                        dirname: path,
                        adapter: "file-json"
                    });
                }
            }
        });
    });
}

PM.prototype.initForPackagePath = function(packagePath, parentPM) {
    var self = this;
    return Q.call(function() {
        if (parentPM) {
            self.context = UTIL.copy(parentPM.context);
            // Resolve path to package based on locator specified in `program.json`.
            if (packagePath === null) {
                var packageLocator = self.context.program.descriptor.json.package;
                if (packageLocator) {
                    // TODO: Refactor into PINF resolver.
                    if (typeof packageLocator === "string") {
                        // @credit https://github.com/c9/architect/blob/c8b2d22b8d09acf8c104b11f8da416eecd458eee/architect.js#L327
                        function resolvePackage(base, packagePath) {
                            if (packagePath === "." || packagePath === "/") {
                                var newPath = PATH.resolve(base, packagePath, "package.json");
                                if (PATH.existsSync(newPath)) return PATH.dirname(newPath);
                            }
                            else {
                                while (base) {
                                    var newPath = PATH.resolve(base, "node_modules", packagePath, "package.json");
                                    if (PATH.existsSync(newPath)) return PATH.dirname(newPath);
                                    base = base.substr(0, base.lastIndexOf("/"));
                                }
                            }
                            throw new Error("Can't find '" + packagePath + "' relative to '" + base + '"');
                        }
                        packagePath = FS.realpathSync(resolvePackage(self.context.program.package.path, packageLocator));
                    } else {
                        throw new Error("NYI");
                    }
                } else {
                    packagePath = PATH.dirname(self.context.program.path);
                }
            }
        }
        self.context.package = new PACKAGE.Package();        
        return self.context.package.initForPath(packagePath).then(function() {
            if (!self.context.metaBasePath) {
                // TODO: Rename '.sourcemint' to '.pinf' once standardized.
                self.context.metaBasePath = PATH.join(self.context.package.path, ".sourcemint");
            }
        });
    });
}

PM.prototype.install = function(options) {
    try {
        return require("./commands/install").main(this, options || {});
    } catch(err) {
        return Q.when(Q.ref(), function() {
            throw err;
        });
    }
}

PM.prototype.update = function(options) {
    return require("./commands/update").main(this, options || {});
}

PM.prototype.status = function(options) {
    return require("./commands/status").main(this, options || {});
}

PM.prototype.bump = function(options) {
    return require("./commands/bump").main(this, options || {});
}

PM.prototype.publish = function(options) {
    return require("./commands/publish").main(this, options || {});
}

PM.prototype.clone = function(options) {
    return require("./commands/clone").main(this, options || {});
}

PM.prototype.deploy = function(options) {
    return require("./commands/deploy").main(this, options || {});
}

PM.prototype.ssh = function(options) {
    return require("./commands/ssh").main(this, options || {});
}

PM.prototype.runScript = function(options) {
    return require("./commands/run-script").main(this, options || {});
}

PM.prototype.help = function(options) {
    return require("./commands/help").main(this, options || {});
}

PM.prototype.fix = function(options) {
    return require("./commands/fix").main(this, options || {});
}

PM.prototype.edit = function(options) {
    return require("./commands/edit").main(this, options || {});
}

PM.prototype.path = function(options) {
    var self = this;
    options = options || {};
    if (self.context.program && self.context.package && options.pm) {
        var handler = require("sourcemint-pm-" + options.pm + "/lib/pm");
        if (typeof handler.path === "function") {
            return handler.path(self, options);
        }
    }
    return Q.call(function() {
        if (self.context.package.path) {
            return self.context.package.path;
        }
        else if (self.context.program.package.path) {
            return self.context.program.package.path;
        }
    });    
}

exports.clone = function(targetPath, options) {
    
    var deferred = Q.defer();
    
    if (!PATH.existsSync(PATH.dirname(targetPath))) {
        if (options.create === true) {
            TERM.stdout.writenl("\0cyan(Creating path '" + PATH.dirname(targetPath) + "'.\0)");
            FS_RECURSIVE.mkdirSyncRecursive(PATH.dirname(targetPath));
        } else {
            TERM.stdout.writenl("\0red(" + "ERROR: " + "Cannot clone to '" + targetPath + "' as parent path '" + PATH.dirname(targetPath) + "' does not exist! Use -c to create parent path." + "\0)");
            deferred.reject();
            return deferred.promise;
        }
    }

    if (PATH.existsSync(targetPath)) {
        if (options.delete === true) {
            TERM.stdout.writenl("\0cyan(Deleting path '" + targetPath + "'.\0)");
            FS_RECURSIVE.rmdirSyncRecursive(targetPath);
        } else {
            TERM.stdout.writenl("\0red(" + "ERROR: " + "Target path '" + targetPath + "' exists! Use -d to delete what is already there." + "\0)");
            deferred.reject();
            return deferred.promise;
        }
    }
    
    FS.mkdirSync(targetPath);

    Q.when(exports.forProgramPath(targetPath).then(function(pm) {
        return exports.forPackagePath(targetPath, pm).then(function(pm) {
            
            FS.rmdirSync(targetPath);
            
            return pm.clone(options);
        });
    })).fail(function(err) {
        if (typeof err === "object") {
            err.showHelp = function() {
                TERM.stdout.writenl("\0red(");
                TERM.stdout.writenl("We had an error cloning.");
                TERM.stdout.writenl("Try re-cloning with the -d flag to delete the target directory first (or delete yourself and try again).");
                TERM.stdout.writenl("If cloning keeps failing due to GIT errors you need to resolve these. Like setting up SSH for accessing github.");
                TERM.stdout.writenl("If cloning seems to fail due to a corrupt git repository or `sm` or `npm` error you can wipe the install cache (~/.sourcemint/*-cache) and try again.");
                TERM.stdout.writenl("If problems persist email your clone URL to the mailing list for support (must be publicly accessible): http://groups.google.com/group/sourcemint");
                TERM.stdout.writenl("\0)");
            }
        }
        throw err;
    }).then(deferred.resolve, deferred.reject);
    
    return deferred.promise;
}

