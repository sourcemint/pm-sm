
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

    var overallInfo = null;

    TERM.stdout.writenl("");

    return statusTree.forEachNode(function(node) {

        if (overallInfo === null) {
            overallInfo = node.status.deepStatus;
        }

        // Don't go deeper than first level if we don't want to see all and there are no errors in children.
        if (
            options.all !== true && node.level > 1 &&
            !node.status.deepStatus.errors &&
            (!node.status.deepStatus.newOutVersion || node.status.summary.inParent)
        ) {
            return false;
        }

        var info = node.status.status;

        // Generate output.

        var line = [];

        var padding = "  ";
        for (var i=0 ; i<=node.level ; i++) padding += "  ";
        if (info.vcs) {
            if (info.vcs.mode === "write") {
                line.push(" \0cyan(W\0) " + padding.substring(3));
            } else
            if (info.vcs.mode === "read") {            
                line.push(" \0cyan(R\0) " + padding.substring(3));
            }
        } else {
            line.push(padding);
        }

        line.push("\0" + ((info.installed)?"yellow":"red") + "(");
        if (node.level <= 1) {
            line.push("\0bold(" + info.name + "\0)");
        } else {
            line.push(info.name);
        }
        line.push("@");
        if (info.installed) {
            line.push(info.version + "\0)");
        } else {
            line.push("\0bold(MISSING\0)");
        }

        if (info.npm) {

            line.push(" \0" + ((!info.newInVersion && info.installed)?"green":"red") + "(");
            if (info.newInVersion) {
                line.push("\0bold(<-\0) " + info.newInVersion);
            }
            line.push("npm");
            if (info.selector) {
                line.push(info.selector);
            }
            if (info.newOutVersion) {
                line.push("\0magenta(\0bold(<-\0) " + info.newOutVersion + "\0)");
            }
            line.push("\0)");
        }

        if (info.git) {
            line.push(" \0" + ((!(info.git.dirty || info.git.behind || info.git.remoteAhead))?"green":"red") + "(git");
            if (info.git.branch !== "master" && node.status.locator && info.git.rev !== node.status.locator.version) {
                line.push("\0orange(" + info.git.branch + "\0)");
            } else {
                line.push(info.git.branch);
            }
            if (info.git.dirty) {
                line.push("\0bold(dirty\0)");
            } else
            if (info.git.behind) {
                line.push("\0bold(behind\0)");
            } else
            if (info.git.remoteAhead) {
                line.push("\0bold(unpushed\0)");
            } else
            if (info.git.tagged) {
                line.push("(" + info.git.tagged + ")");
            } else {
                if (info.npm) {
                    line.push("\0magenta(\0bold(-(\0)" + info.git.rev + "\0bold()>\0) \0bold(npm\0)\0)");                        
                }
            }

            line.push("\0) ");
        }

        var parentLinked = false;
        return node.forEachParent(function(node, level) {
            if (info.symlinked && !parentLinked) {
                parentLinked = node;
            }
        }).then(function() {

            if (node.status.summary) {
                if (node.level === 0) {
                    line.push(" (" + node.path + ")");
                } else
                if (info.symlinked) {
                    line.push(" \0cyan(" + node.path + "\0)");
                } else
                if (node.status.summary.inParent) {
                    var up = " ";
                    for(var i=0;i<node.status.summary.inParent;i++) up += "../../";
                    line.push(up.substring(0, up.length-1));
                    line = line.map(function(segment) {
                        return segment.replace(/\0(yellow|green|magenta|red|cyan|bold)\(/g, "\0white(");
                    });
                }
            }

            if (node.circular) {
                line = line.map(function(segment) {
                    return segment.replace(/\0(yellow|green|magenta|red|cyan|bold)\(/g, "\0white(");
                });
                line[1] = "\xA4 " + line[1];
                /*
                // TODO: Verify. This should show whole line even though package was found in parent and has children.
                if (!(node.status.summary && node.status.summary.inParent)) {
                    line = line.slice(0, 4).join(" ");
                }
                */
                line = line.slice(0, 4).join(" ");
                TERM.stdout.writenl(line);
            } else {
                TERM.stdout.writenl(line.join(" "));
            }

            // Don't go deeper if no deep errors found (new deep out version may be present) and we had a newOutVersion ourself.
            // We only want to show the first newOutVersion and ignore all below (if no errors) (as they will likely update if parent updates
            // and parent needs to be updated first anyway).
            if (
                options.all !== true && node.level >= 1 &&
                !node.status.deepStatus.errors &&
                node.status.status.newOutVersion
            ) {
                return false;
            }            
        });

    }).then(function() {

        var errorMessages = [];

//console.log("overallInfo", overallInfo);

        if (overallInfo.errors) {
            if (overallInfo.missing) {
                errorMessages.push("  \0red(To fix \0bold(MISSING\0) run: \0bold(sm install\0) or \0bold(sm update\0)\0)");
            }
            if (overallInfo.newInVersion) {
                errorMessages.push("  \0red(To fix \0bold(<-\0) run: \0bold(sm update\0)\0)");
            }
            if (overallInfo.dirty) {
                errorMessages.push("  \0red(To fix \0bold(dirty\0) commit your changes.\0)");
            }
            if (errorMessages.length > 0) {
                TERM.stdout.writenl("");
                errorMessages.forEach(function(message) {
                    TERM.stdout.writenl(message);
                });
                TERM.stdout.writenl("");

                var deferred = Q.defer();
                deferred.reject(true);
                return deferred.promise;
            } else {
                throw new Error("`overallInfo.ok === false` but no specific error property found.");
            }
        } else
        if (options.update) {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("  \0green(\0bold(All good!\0) Nothing to update.\0)");
            TERM.stdout.writenl("");
        } else {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("  \0green(\0bold(All good!\0) Use -n to fetch latest remote info.\0)");
            if (overallInfo.newOutVersion) {
                TERM.stdout.writenl("  \0magenta(To fix \0bold(<-\0) update package.json and run: sm update\0)");
            }
            TERM.stdout.writenl("");
        }
/*
        if (unsynced) {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("  \0magenta(Solve \0bold(PURPLE\0) states to bring package/program in sync with latest sources.\0)");
            TERM.stdout.writenl("  \0magenta(Use --latest to fetch latest remote info.\0)");
            TERM.stdout.writenl("");
            CLI.failAndExit(true);
        } else {
        }
*/
    });
}

