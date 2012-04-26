
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const EXEC = require("child_process").exec;
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const PROGRAM = require("sourcemint-pinf-js/lib/program");
const PACKAGE = require("sourcemint-pinf-js/lib/package");


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
    this.context = {
        time: new Date().getTime()
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
