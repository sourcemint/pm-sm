
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const Q = require("sourcemint-util-js/lib/q");
const CORE = require("../core");


exports.main = function(pm, options) {

    if (options.pm) {
        return require("sourcemint-pm-" + options.pm + "/lib/pm").status(pm, options);
    }

    var opts = UTIL.copy(options);
    // Always set `all` to true so we get all dependencies in case there are errors deep down.
    opts.all = true;
    return CORE.getStatusTree(pm, opts).then(function(statusTree) {
        return exports.printTree(statusTree, options);
    });
}


exports.printTree = function(statusTree, options) {

    var rootNode = null;
    var overallInfo = null;

    TERM.stdout.writenl("");

    var printOptions = UTIL.copy(options);
    printOptions.mode = "tree";

    return statusTree.forEachReadyNodeRecursive(function(node) {

        if (rootNode === null) {
            rootNode = node;
            overallInfo = node.status.deepStatus;
        }

        // Don't go deeper than first level if we don't want to see all and there are no errors or updates in children.
        if (
            options.all !== true && node.level > 1 &&
            !node.status.deepStatus.errors &&
            !node.status.deepStatus.vcs &&
            ((!node.status.deepStatus.newLocator && !node.status.deepStatus.newOutLocator) || node.status.status.inParent)
        ) {
            return false;
        }

        node.print(printOptions);

        // Don't go deeper if no deep errors found (deep newOutLocator may be present) and we had a newOutLocator ourself.
        // We only want to show the first newOutLocator and ignore all below (if no errors) (as they will likely update if parent updates
        // and parent needs to be updated first anyway).
        if (
            options.all !== true && node.level >= 1 &&
            !node.status.deepStatus.errors &&
            !node.status.deepStatus.newLocator &&
            node.status.status.newOutLocator
        ) {
            return false;
        }

    }).then(function() {

        var errorMessages = [];
        var helpMessages = [];

        // TODO: Determine if these messages are needed by tracking what `node.print()` actually prints vs relying on `overallInfo["<*-"]`.

        if (overallInfo["<sticky-"]) {
            helpMessages.push("  \0magenta(To fix \0bold(<s-\0) update top sm-catalog.locked.json and run: sm install\0)");
        }
        if (overallInfo["<new-"]) {
            if (rootNode.status["sm-catalog"]) {
                helpMessages.push("  \0magenta(To fix \0bold(<n-\0) run: sm update\0)");
            } else
            if (rootNode.status["npm-shrinkwrap"]) {
                helpMessages.push("  \0magenta(To fix \0bold(<n-\0) update top npm-shrinkwrap.json and run: sm install\0)");
            }
        }
        if (overallInfo["<out(top)-"] || overallInfo["<out(transitive)-"]) {
            if (rootNode.status["sm-catalog-locked"]) {
                helpMessages.push("  \0magenta(To fix \0bold(<o-\0) update package.json of parent or top sm-catalog.locked.json and run: sm update\0)");
            } else {
                if (overallInfo["<out(top)-"]) {
                    helpMessages.push("  \0magenta(To fix \0bold(<o-\0) run: \0bold(sm update \0yellow(name [pointer]\0)\0)\0)");
                }
                if (overallInfo["<out(transitive)-"]) {
                    helpMessages.push("  \0magenta(To fix <o- update package.json of all transitive parents (and publish them), then run: sm update\0)");
                }
            }
        }

        if (overallInfo.errors) {
            if (overallInfo.dirty) {
                errorMessages.push("  \0red(To fix \0bold(dirty\0) run: \0bold(git add/commit [...]\0)\0)");
            }
            if (overallInfo["<locked-must"]) {
                errorMessages.push("  \0red(To fix \0bold(<l-\0) run: \0bold(sm install\0)\0)");
            }
            if (overallInfo["<sticky-must"]) {
                errorMessages.push("  \0red(To fix \0bold(<s-\0) run: \0bold(sm install\0)\0)");
            }
            if (overallInfo["<platform-must"]) {
                errorMessages.push("  \0red(To fix \0bold(<p-\0) run: \0bold(sm install\0)\0)");
            }
            if (overallInfo["<new-must"]) {
                errorMessages.push("  \0red(To fix \0bold(<n-\0) run: \0bold(sm update\0)\0)");
            }
            if (overallInfo["<undeclared-must"]) {
                errorMessages.push("  \0red(To fix \0bold(UNDECLARED\0) remove or run: \0bold(sm update\0)\0)");
            }
            if (!overallInfo.dirty) {
                if (overallInfo.behind) {
                    errorMessages.push("  \0red(To fix \0bold(behind\0) run: \0bold(git pull [...]\0)\0)");
                } else
                if (overallInfo.ahead) {
                    errorMessages.push("  \0red(To fix \0bold(ahead\0) run: \0bold(git push [...]\0)\0)");
                }
            }
            if (errorMessages.length > 0) {
                TERM.stdout.writenl("");
                errorMessages.forEach(TERM.stdout.writenl);
                helpMessages.forEach(TERM.stdout.writenl);
                TERM.stdout.writenl("");

                var ok = false;
                if (options.command === "edit") {
                    ok = true;
                    TERM.stdout.writenl("  \0green(Package setup for editing.\0)");
                    TERM.stdout.writenl("");
                } else
                if (options.command === "install") {
                    if (overallInfo.mustInstall) {
                        TERM.stdout.writenl("  \0red(ERROR: Found \0bold(<*-\0) after install. Try re-running: \0bold(sm install\0)\0)");
                        TERM.stdout.writenl("");
                    } else {
                        ok = true;
                        TERM.stdout.writenl("  \0green(\0bold(All good!\0) Nothing [more] to install.\0)");
                        TERM.stdout.writenl("");
                    }
                } else
                if (options.command === "update") {
                    if (overallInfo.missing) {
                        TERM.stdout.writenl("  \0red(ERROR: Found \0bold(MISSING\0) after update. Try re-running: \0bold(sm install\0)\0)");
                        TERM.stdout.writenl("");
                    } else
                    if (overallInfo.mustInstall || overallInfo.mustUpdate) {
                        TERM.stdout.writenl("  \0red(ERROR: Found \0bold(<*-\0) after update. Try re-running: \0bold(sm update\0)\0)");
                        TERM.stdout.writenl("");
                    } else {
                        ok = true;
                        TERM.stdout.writenl("  \0green(\0bold(All good!\0) Nothing [more] to update.\0)");
                        TERM.stdout.writenl("");
                    }
                }
                if (!ok) {
                    var deferred = Q.defer();
                    deferred.reject(true);
                    return deferred.promise;
                }
            } else {
                throw new Error("`overallInfo.ok === false` but no specific error property found.");
            }
        } else
        if (options.command === "edit") {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("  \0green(Package setup for editing.\0)");
            TERM.stdout.writenl("");
        } else
        if (options.command === "update") {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("  \0green(\0bold(All good!\0) Nothing [more] to update.\0)");
            TERM.stdout.writenl("");
        } else
        if (options.command === "install") {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("  \0green(\0bold(All good!\0) Nothing [more] to install.\0)");
            TERM.stdout.writenl("");
        } else {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("  \0green(\0bold(All good!\0) Use -n to fetch latest remote info.\0)");
            helpMessages.forEach(TERM.stdout.writenl);
            if (overallInfo["<undeclared-"]) {
                if (rootNode.status["sm-catalog-locked"]) {
                    TERM.stdout.writenl("  \0magenta(To fix \0bold(UNDECLARED\0) update package.json of parent or top sm-catalog.locked.json and run: sm update.\0)");
                } else {
                    TERM.stdout.writenl("  \0magenta(To fix \0bold(UNDECLARED\0) update package.json of parent and run: sm install.\0)");
                }
            }
            TERM.stdout.writenl("");
        }
    });
}

