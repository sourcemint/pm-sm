
var ASSERT = require("assert");
var PATH = require("path");
var FS = require("fs");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var GIT_PM = require("sourcemint-pm-git/lib/pm");
var SM_PM = require("../pm");
var URI_PARSER = require("../uri-parser");



exports.main = function(pm, options) {
    
    return SM_PM.forPackagePath(pm.context.package.path, pm).then(function(pm) {
        return GIT_PM.clone(pm, options);
    });

}
