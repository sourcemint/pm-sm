
const Q = require("sourcemint-util-js/lib/q");
const INSTALL = require("./install");
const TERM = require("sourcemint-util-js/lib/term");
const UTIL = require("sourcemint-util-js/lib/util");
const URL_PROXY_CACHE = require("sourcemint-util-js/lib/url-proxy-cache");
const PATH = require("path");
const FS = require("fs");
const EXEC = require("child_process").exec;


exports.main = function(pm, options) {

    return checkForUpdate(pm, options).then(function() {

        options.update = true;

        return INSTALL.main(pm, options);
    });
}




function checkForUpdate(pm, options) {

    var cache = new URL_PROXY_CACHE.UrlProxyCache(PATH.join(pm.context.homeBasePath, "url-cache"), {
        verbose: options.verbose,
        ttl: (1 * 24 * 60 * 60 * 1000)    // 1 Day
    });
    return cache.get("https://registry.npmjs.org/sm").then(function(response) {

        var descriptor = JSON.parse(response.body.toString());
        
        var latestVersion = descriptor["dist-tags"].latest;

        var deferred = Q.defer();

        EXEC("sm --version", function(err, stdout, stderr) {
            if (err) {
                deferred.reject(err);
                return;
            }
            var actualVersion = UTIL.trim(stdout.replace(/\n$/, ""));

            if (actualVersion !== latestVersion) {

                TERM.stderr.writenl(" \0magenta(!");
                TERM.stderr.writenl(" !  " + "A NEW VERSION (" + latestVersion + ") of `sm` is available! You are running '" + actualVersion + "'. Please update ASAP:");
                TERM.stderr.writenl(" !");
                TERM.stderr.writenl(" !  \0magenta(" + "    npm update -g sm" + "\0)");
                TERM.stderr.writenl(" !\0)");
            }

            deferred.resolve();
        });        
        
        return deferred.promise;

    }).fail(function(err) {
        TERM.stderr.writenl("\0orange(" + "Got error '" + err + "' while checking for `sm` update at https://registry.npmjs.org/sm" + "\0)");
        // Silence the error
    });

    return deferred.promise;
}

