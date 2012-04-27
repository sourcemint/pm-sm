
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const EXEC = require("child_process").exec;
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const PROGRAM = require("sourcemint-pinf-js/lib/program");
const PACKAGE = require("sourcemint-pinf-js/lib/package");
const FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");


exports.forProgramPath = function(programPath) {
    var pm = new PM();
    return pm.initForProgramPath(programPath).then(function() {
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
}

PM.prototype.initForProgramPath = function(programPath) {
    var self = this;
    return Q.call(function() {
        self.context.program = new PROGRAM.Program();
        return self.context.program.initForPath(programPath).then(function() {
            // TODO: Rename '.sourcemint' to '.pinf' once standardized.
            self.context.metaBasePath = PATH.join(PATH.dirname(self.context.program.path), ".sourcemint");
        });
    });
}

PM.prototype.initForPackagePath = function(packagePath, parentPM) {
    var self = this;
    return Q.call(function() {
        if (parentPM) {
            self.context = UTIL.copy(parentPM.context);
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
    return require("./commands/install").main(this, options || {});
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


exports.clone = function(targetPath, options) {
    
    if (!PATH.existsSync(PATH.dirname(targetPath))) {
        if (options.create === true) {
            FS_RECURSIVE.mkdirSyncRecursive(PATH.dirname(targetPath));
        } else {
            TERM.stdout.writenl("\0red(" + "ERROR: " + "Cannot clone to '" + targetPath + "' as parent path '" + PATH.dirname(targetPath) + "' does not exist! Use -c to create parent path." + "\0)");
            CLI.failAndExit();
            return;
        }
    }

    if (PATH.existsSync(targetPath)) {
        if (options.delete === true) {
            FS_RECURSIVE.rmdirSyncRecursive(targetPath);
        } else {
            TERM.stdout.writenl("\0red(" + "ERROR: " + "Target path '" + targetPath + "' exists! Use -d to delete what is already there." + "\0)");
            return;
        }
    }
    
    FS.mkdirSync(targetPath);

    return exports.forProgramPath(targetPath).then(function(pm) {
        return exports.forPackagePath(targetPath).then(function(pm) {
            return pm.clone(options);
        });
    });
}

