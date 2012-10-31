
const TERM = require("sourcemint-util-js/lib/term");
const UTIL = require("sourcemint-util-js/lib/util");
const Q = require("sourcemint-util-js/lib/q");
const SM_STATUS = require("./status");
const CORE = require("../core");


exports.main = function(pm, options) {

/*
    if (options.pm) {
        return require("sourcemint-pm-" + options.pm + "/lib/pm").edit(pm, options);
    }
*/

    var opts = UTIL.copy(options);
    opts.all = true;    
    return CORE.getStatusTree(pm, opts).then(function(statusTree) {

        var found = {};
        var selector = options.args;
        selector[0] = selector[0].replace(/\/$/, "");
        var pointer = selector[1] || false;

        return statusTree.forEachReadyNodeRecursive(function(node) {

            // TODO: Make root package editable.
            if (node.level === 0) return true;

            if (
                node.status.status.symlinked === "outside"
            ) return false;    // Don't traverse depper.

            if (node.name === selector[0]) {
                found[node.status.status.relpath] = node;
            } else
            if (node.status.status.relpath === selector[0]) {
                found[node.status.status.relpath] = node;
            }

            return true;

        }).then(function() {

            if (UTIL.len(found) === 0) {
                TERM.stdout.writenl("\0red([sm] ERROR: Could not find dependency via '\0yellow(" + selector + "\0)'. See `\0bold(sm status -i\0)` for dependency names or paths to use.\0)");
                var deferred = Q.defer();
                deferred.reject(true);
                return deferred.reject();
            }
            if (UTIL.len(found) > 1) {
                TERM.stdout.writenl("\0red([sm] ERROR: Found \0bold(multiple\0) dependencies via '\0yellow(" + selector + "\0)'. Pick one of the following by using the path.\0)");
                var opts = UTIL.copy(options);
                opts.info = true;
                UTIL.forEach(found, function(found) {
                    found[1].print(opts);
                });
                var deferred = Q.defer();
                deferred.reject(true);
                return deferred.reject();
            }

            found = found[Object.keys(found)[0]];

            return found.edit(pointer, options);
        });
    });
}
