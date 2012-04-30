
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
    
    return GIT_PM.clone(pm, options).then(function() {
        if (options.install === true) {

            TERM.stdout.writenl("\0cyan(Installing package: " + pm.context.package.path + "\0)");
            
            var deferred = Q.defer();
            
            var args = [
                "install",
                "."
            ];

            var proc = SPAWN("sm", args, {
                cwd: pm.context.package.path
            });

            proc.on("error", function(err) {
                deferred.reject(err);
            });
            
            proc.stdout.on("data", function(data) {
                TERM.stdout.write(data.toString());
            });
            proc.stderr.on("data", function(data) {
                TERM.stderr.write(data.toString());
            });
            proc.on("exit", function(code) {
                if (code !== 0) {
                    deferred.reject(new Error("sm error"));
                    return;
                }
                deferred.resolve();
            });                    

            return deferred.promise;
        }        
    }).then(function() {

        if (options.help === true) {
        
            pm.context.program.package.descriptor.reload();
    
            return pm.help();
        }
    });
}
