
const TERM = require("sourcemint-util-js/lib/term");
const UTIL = require("sourcemint-util-js/lib/util");
const Q = require("sourcemint-util-js/lib/q");
const CORE = require("../core");


exports.main = function(pm, options) {

    if (options.pm) {
        return require("sourcemint-pm-" + options.pm + "/lib/pm").edit(pm, options);
    }

    var opts = UTIL.copy(options);
    opts.all = true;    
    return CORE.getStatusTree(pm, opts).then(function(statusTree) {

        var found = {};
        var selector = options.args[0];

        return statusTree.forEachNode(function(node) {

            // TODO: Make root package editable.
            if (node.level === 0) return true;

            if (
                (node.status.summary && node.status.summary.inParent) ||
                (node.status.status && node.status.status.symlinked === "outside")
            ) return false;    // Don't traverse depper.

            if (node.name === selector) {
                found[node.status.status.relpath] = node;
            } else
            if (node.status.status.relpath === selector) {
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
                TERM.stdout.writenl("\0red([sm] ERROR: Found \0bold(multiple\0) dependencies via '\0yellow(" + selector + "\0)'. See `\0bold(sm status -i\0)` and use \0bold(path\0) of specific dependency you want to edit.\0)");
                var deferred = Q.defer();
                deferred.reject(true);
                return deferred.reject();
            }

            return found[Object.keys(found)[0]].edit();
        });
    });
}
