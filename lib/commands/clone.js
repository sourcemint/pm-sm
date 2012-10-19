
var ASSERT = require("assert");
var PATH = require("path");
var FS = require("fs");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var GIT_PM = require("sourcemint-pm-git/lib/pm");
var SM_PM = require("../pm");
var URI_PARSER = require("../uri-parser");
var SPAWN = require("child_process").spawn;



exports.main = function(pm, options) {

    var done = Q.ref();

    done = Q.when(done, function() {

        TERM.stdout.writenl("\0cyan([sm] Cloning '" + options.locator + "' to: " + pm.context.package.path + "\0)");

        var parsedUri = URI_PARSER.parse(options.locator);

        if (options.forceClone === true) {
            return GIT_PM.clone(pm, options);
        }
        else {
            var opts = UTIL.copy(options);
            opts.pm = "tar";
            if (parsedUri.locators && parsedUri.locators["tar"]) {
                opts.locator = parsedUri.locators["tar"];
            }
            return pm.install(opts);
        }
    });

    return Q.when(done, function() {
        if (options.install === true) {

            TERM.stdout.writenl("\0cyan([sm] Installing: " + pm.context.package.path + "\0)");

            delete options.install;
            delete options.cached;
            delete options.forceClone;

            return pm.install(options);
        }        
    }).then(function() {

        if (options.help === true) {

            pm.context.program.package.descriptor.reload();

            return pm.help().fail(function(err) {
                // silence HELP error (help may not be setup for project)
            });
        }
    });
}
