
var PATH = require("path");
var FS = require("fs");
var TERM = require("sourcemint-util-js/lib/term");
var UTIL = require("sourcemint-util-js/lib/util");
var Q = require("sourcemint-util-js/lib/q");
var GIT = require("sourcemint-pm-git/lib/git");
var SEMVER = require("semver");
var SM_PM = require("../pm");



exports.main = function(pm, options) {

    return Q.call(function() {

        var help = pm.context.program.package.descriptor.json.help;

        if (!help) {
            throw new Error("No 'help' property found in package descriptor '" + pm.context.program.package.descriptor.path + "'!");
        }
        
        if (typeof help === "string") {
            if (/^.\/|^node /.test(help)) {
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

        TERM.stderr.writenl("\n\0yellow(" + "  \0bold(Package Path :\0) " + packagePath);

        if (help.web) {
            TERM.stderr.writenl("\0bold(      Web help :\0) " + help.web + "\n");
        }

        TERM.stderr.writenl("");
        
        if (help.cli) {

            if (/^node /.test(help.cli)) {
                help.cli = help.cli.replace(/^node\s*/, "").replace(/\.js$/, "") + ".js";
            }

            // TODO: Allow for remote URIs.

            help.cli = PATH.join(packagePath, help.cli);

            if (/\.js$/.test(help.cli)) {

                var helpScript = require(help.cli);
                
                if (typeof helpScript.main === "function") {
                    helpScript.main({
                        TERM: TERM
                    });
                }

            } else
            if (/\.md$/.test(help.cli)) {

                var readme = FS.readFileSync(help.cli).toString();

                TERM.stdout.writenl("  " + readme.replace(/(^\n*|\n*$)/g, "").split("\n").join("\n  "));
            } else {
                throw new Error("TODO: Exec '" + help.cli + "'.");
            }
        }

        TERM.stderr.writenl("\0)\n");
    });
}
