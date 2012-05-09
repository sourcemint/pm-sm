
var PATH = require("path");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var GIT = require("sourcemint-pm-git/lib/git");
var SEMVER = require("semver");
var SM_PM = require("../pm");



exports.main = function(pm, options) {

    var deferred = Q.defer();

    var help = pm.context.program.package.descriptor.json.help;

    if (!help) {
        TERM.stderr.writenl("\0yellow(WARN: No 'help' property found in package descriptor '" + pm.context.program.package.descriptor.path + "'!\0)");
        deferred.reject();
        return deferred.promise;
    }
    
    if (typeof help === "string") {
        if (/^.\//.test(help)) {
            help = {
                cli: help
            };
        } else {
            help = {
                web: help
            };
        }
    }

    var packagePath = pm.context.program.package.path;

    if (/^.\//.test(help.cli)) {
        help.cli = PATH.join(packagePath, help.cli);
    }

    TERM.stderr.writenl("\n\0yellow(" + "  \0bold(Package Path :\0) " + packagePath);

    if (help.web) {
        TERM.stderr.writenl("\0bold(      Web help :\0) " + help.web + "\n");
    }

    TERM.stderr.writenl("");
    
    if (help.cli) {
        
        var helpScript = require(help.cli);
        
        if (typeof helpScript.main === "function") {
            helpScript.main({
                TERM: TERM
            });
        }
    }

    TERM.stderr.writenl("\0)\n");

    return deferred.promise;
}
