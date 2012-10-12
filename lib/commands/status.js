
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("graceful-fs");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const Q = require("sourcemint-util-js/lib/q");
const WAIT_FOR = require("sourcemint-util-js/lib/wait-for");
const PACKAGES = require("sourcemint-pinf-js/lib/packages");
const DESCRIPTORS = require("sourcemint-pinf-js/lib/descriptors");
const URI_PARSER = require("../uri-parser");
const SEMVER_NPM = require("semver");
const EVENTS = require("events");
const SM_PM = require("../pm");


exports.main = function(pm, options) {

    if (options.pm) {
        return require("sourcemint-pm-" + options.pm + "/lib/pm").status(pm, options);
    }

    var opts = UTIL.copy(options);
    // Always set `all` to true so we get all dependencies in case there are errors deep down.
    opts.all = true;
    return exports.getStatusTree(pm, opts).then(function(statusTree) {
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
        if (options.all !== true && node.level > 1 && !node.status.deepStatus.errors) {
            return false;
        }

if (node.name === "ace") {
//    console.log(node.status);
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

        line.push("\0" + ((info.installed)?"yellow":"red") + "(\0bold(" + info.name + "\0)");
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
        });

    }).then(function() {

        var errorMessages = [];

//console.log("overallInfo", overallInfo);

        if (overallInfo.errors) {
            if (overallInfo.missing) {
                errorMessages.push("  \0red(To fix \0bold(MISSING\0) states run: \0bold(sm install\0) or \0bold(sm update\0)\0)");
            }
            if (overallInfo.newInVersion) {
                errorMessages.push("  \0red(To fix \0bold(<-\0) states run: \0bold(sm update\0)\0)");
            }
            if (overallInfo.dirty) {
                errorMessages.push("  \0red(To fix \0bold(dirty\0) states commit your changes.\0)");
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
        } else {
            TERM.stdout.writenl("");
            TERM.stdout.writenl("  \0green(\0bold(All good!\0) Package is in a saved state.\0)");
            TERM.stdout.writenl("  \0green(Use --now to fetch latest remote info.\0)");
            if (overallInfo.newOutVersion) {
                TERM.stdout.writenl("  \0magenta(New out of range dependency releases found (\0bold(<-\0)).\0)");
                TERM.stdout.writenl("  \0magenta(FIX: Update dependency declarations\n  in package.json and run: sm update\0)");
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




var BaseNode = function() {
    this.name = null;
    this.path = null;
    this.level = 0;
    this.children = {};
    this.parent = null;
}
BaseNode.prototype = new EVENTS.EventEmitter();
// TODO: Rename to: forEachNodeRecursive
BaseNode.prototype.forEachNode = function(callback) {
    var self = this;
    return Q.call(function() {
        return Q.when(callback(self), function(oo) {
            if (oo === false) return;
            if (self.circular) return;
            return self.forEachChildRecursive(callback);
        });
    });
}
BaseNode.prototype.forEachChildRecursive = function(callback) {
    var self = this;
    var done = Q.ref();
    UTIL.forEach(self.children, function(child) {
        done = Q.when(done, function() {
            return child[1].forEachNode(callback);
        });
    });
    return done;
}
BaseNode.prototype.forEachChild = function(callback) {
    var self = this;
    var done = Q.ref();
    UTIL.forEach(self.children, function(child) {
        done = Q.when(done, function() {
            return callback(child[1]);
        });
    });
    return done;
}
BaseNode.prototype.forEachParent = function(callback, level) {
    var self = this;
    level = level || 0;
    level += 1;
    return Q.call(function() {
        if (self.parent) {
            return Q.when(callback(self.parent, level), function() {
                return self.parent.forEachParent(callback, level);
            });
        }
    });
}



exports.getStatusTree = function(pm, options) {

    var Node = function(node, parent) {
        this.parent = parent || null;
        this.children = {};
        if (node) this.initFromFsNode(node);
    }
    Node.prototype = new BaseNode();
    Node.prototype.initFromFsNode = function(node) {
        var self = this;
        self.name = node.name;
        self.path = node.path;
        self.circular = node.circular || false;
        if (!self.fsNode) {
            self.level = node.level;
            self.fsNode = node;
            self.status = UTIL.deepCopy(node.status);
        } else {
            self.children = {};
            var locator = self.status.locator;
            self.status = UTIL.deepCopy(node.status);
            self.status.locator = locator;
        }

        // TODO: Eventually get rid of `self.status.summary` in favor of `self.status.status`.

        // Summarize status.

        if (!self.parent && !self.name && self.status.descriptor) {
            // Set name of root package.
            self.name = self.status.descriptor.name;
        }

        self.status.summary = self.status.summary || {};

        if (self.status.descriptor) {
            self.status.summary.version = self.status.descriptor.version || false;
            self.status.summary.libDir = "lib";
            if (self.status.descriptor.directories && typeof self.status.descriptor.directories.lib !== "undefined") {
                self.status.summary.libDir = self.status.descriptor.directories.lib;
            }
        }

        // "mappings": { "alias": "." }
        if (self.status.locator && self.status.locator.viaSelector === ".") {
            self.status.locator = self.parent.status.locator;
        }

        if (self.status.locator && self.status.locator.viaPm === "npm" && self.status.descriptor) {
            if (
                typeof self.status.locator.viaVersion !== "undefined" &&
                self.status.descriptor._from
            ) {
                var pointer = self.status.descriptor._from.replace(/^[^@]*@/,"");
                if (SEMVER_NPM.valid(pointer)) {
                    // Convert version to URL.
                    self.status.locator.location = self.status.npm.descriptor.versions[pointer].dist.tarball;
                } else {
                    self.status.locator.location = pointer;
                }
            }
        }

        delete self.status.summary.newInSelectorVersion;
        delete self.status.summary.newInSelectorLocation;

        if (self.status.locator && self.status.locator.viaPm === "sm") {
            if (self.status.sourcemint) {
                if (!(
                    self.status.locator.location === self.status.sourcemint.url &&
                    process.version === self.status.sourcemint.nodeVersion
                )) {
                    var locationInfo = URI_PARSER.parse(self.status.locator.location);
                    self.status.summary.newInSelectorVersion = (locationInfo && locationInfo.vendor && locationInfo.vendor.rev) || true;
                    self.status.summary.newInSelectorLocation = self.status.locator.location;
                }
            } else {
                var locationInfo = URI_PARSER.parse(self.status.locator.location);
                self.status.summary.newInSelectorVersion = (locationInfo && locationInfo.vendor && locationInfo.vendor.rev) || true;
                self.status.summary.newInSelectorLocation = self.status.locator.location;
            }
        } else
        if (self.status.locator && self.status.locator.viaPm === "npm") {
            if (self.status.npm) {
                if (self.status.npm.published) {
                    // New version that is in revision selector stream (new 'minor' version).
                    self.status.summary.newInSelectorVersion = false;
                    // New version that is outside of revision selector stream (new 'major' version).
                    self.status.summary.newOutSelectorVersion = false;
                    if (!self.status.npm.usingLatest) {
                        if (!self.status.npm.usingLatestSatisfying) {
                            self.status.summary.newInSelectorVersion = self.status.npm.latestSatisfyingVersion;
                            self.status.summary.newInSelectorLocation = false;
                            if (self.status.npm.descriptor.versions[self.status.summary.newInSelectorVersion]) {
                                self.status.summary.newInSelectorLocation = self.status.npm.descriptor.versions[self.status.summary.newInSelectorVersion].dist.tarball;
                            }
                        } else {
                            self.status.summary.newOutSelectorVersion = self.status.npm.latestVersion;
                        }
                    }
                }
                if (self.status.locator.viaSelector === self.status.locator.location && self.status.locator.version && self.status.git) {
                    if (self.status.locator.version !== self.status.git.rev) {
                        self.status.summary.newOutSelectorVersion = self.status.git.rev;
                    }
                }
            }

        }

        if (self.status.summary.newInSelectorVersion) {
            if (self.status.git && self.status.git.rev === self.status.summary.newInSelectorVersion) {
                self.status.summary.newInSelectorVersion = false;
            }
        }

        if (self.status.descriptor) {
            self.status.summary.installed = true;

/*
            var foundLevel = 0;
            function findWithinParents(parentNode, level) {
                if (!parentNode) return false;
                if (self.path.substring(0, parentNode.path.length) === parentNode.path) {
                    // Found at expected dependency path.
                    foundLevel = level;
                    return true;
                }
                self.status.summary.isLinked = !findWithinParents(parentNode.parent, level + 1);
                self.status.summary.isWithinParents = !self.status.summary.isLinked;
                return self.status.summary.isWithinParents;
            }
            findWithinParents(self.parent, 1);
            if (self.status.summary.isWithinParents) {
                self.status.summary.isWithinParents = foundLevel;
            }
*/                
        } else {
            self.status.summary.installed = false;
//                delete self.status.summary.isLinked;
//                delete self.status.summary.isWithinParents;
        }
        self.status.summary.isSymlinked = self.fsNode.isSymlinked;


        if (self.status.git) {
            self.status.vcs = {};
            if (self.status.git.writable) {
                self.status.vcs.mode = "write";
            } else {
                self.status.vcs.mode = "read";
            }
        }
    }
    Node.prototype.assemble = function(context) {
        var self = this;

        context = UTIL.copy(context);
        context.lastPackageByName = UTIL.copy(context.lastPackageByName || {});

        var deferred = Q.defer();

        if (self.circular) {
            var circular = self.circular;
            self.initFromFsNode(circular);
            self.circular = circular;
        } else
        if (!self.status.summary.installed && context.lastPackageByName[self.name]) {
            for (var i=context.lastPackageByName[self.name].length-1; i>=0 ; i--) {
                if (context.lastPackageByName[self.name][i].status.summary.installed) {
                    self.initFromFsNode(context.lastPackageByName[self.name][i]);
                    self.status.summary.inParent = context.lastPackageByName[self.name].length - i - 1;
                    break;
                }
            }
        }


        // Summarize status data.
        var info = {
            name: self.name,
            installed: self.status.summary.installed,
            symlinked: self.status.summary.isSymlinked || false,
            version: (self.status.descriptor && self.status.descriptor.version) || false,
            newInVersion: (self.status.summary && self.status.summary.newInSelectorVersion) || false,
            newOutVersion: (self.status.summary && self.status.summary.newOutSelectorVersion) || false,
            selector: (self.status.locator &&
                       (self.status.locator.version || 
                        self.status.locator.viaVersion || 
                        self.status.locator.location || 
                        self.status.locator.viaSelector)) || 
                      (self.status.npm && self.status.npm.actualVersion),
            vcs: false
        };

        if ((self.status.locator && self.status.locator.pm === "npm") || (self.status.npm && self.status.npm.published)) {
            info.npm = true;
        }
        if (self.status.git) {
            info.git = self.status.git;
        }
        if (self.status.vcs) {
            info.vcs = self.status.vcs;
        }

        self.status.status = info;


        // Update child status summary.
        var deepStatus = {
            errors: false,
            newInVersion: false,
            newOutVersion: false,
            dirty: false,
            missing: false
        };
        if (!info.installed) {
            deepStatus.errors = true;
            deepStatus.missing = true;
        }
        if (info.newInVersion) {
            deepStatus.errors = true;
            deepStatus.newInVersion = true;
        }
        if (info.newOutVersion) {
            deepStatus.newOutVersion = true;
        }
        if (info.git && info.git.dirty) {
            deepStatus.errors = true;
            deepStatus.dirty = true;
        }
        function updateDeepStatusForChild(node) {
            for (var name in node.status.deepStatus) {
                if (node.status.deepStatus[name] === true) {
                    deepStatus[name] = true;
                }
            }
        }


        // Traverse children.
        UTIL.forEach(self.fsNode.children, function(child) {
            var node = new Node(child[1], self);
            self.children[child[0]] = node;
            if (!context.lastPackageByName[child[0]]) {
                context.lastPackageByName[child[0]] = [];
            }
            context.lastPackageByName[child[0]].push(node);
        });

        var waitFor = WAIT_FOR.makeSerial(function(err) {
            if (err) return deferred.reject(err);            
            self.status.deepStatus = deepStatus;
            deferred.resolve();
        });
        UTIL.forEach(self.children, function(child) {
            waitFor(function(done) {
                Q.when(child[1].assemble(context), done, done).then(function() {
                    updateDeepStatusForChild(child[1]);
                });
            });
        });
        waitFor();

        return deferred.promise;
    }

    return exports.getDependencyTree(pm, options).then(function(fsTree) {
        var rtTree = new Node(fsTree);
        return rtTree.assemble({}).then(function() {
            return rtTree;
        });
    });
}

exports.getDependencyTree = function(pm, options) {

    options = options || {};

    var Node = function(name, level) {
        var self = this;

        self.name = name || "";
        self.path = null;
        self.exists = false;
        self.isSymlinked = false;
        self.level = level || 0;
        self.children = {};
        self.loaders = {};
        self.status = {
            descriptor: false,
            locator: {}
        };
/*
        self.addLoader("descriptor", true, function(options) {            
            if (!self.descriptor || !self.descriptor.json) return false;
            return self.descriptor.json;
        });
*/
/*
        self.addLoader("locator", true, function(options) {

        });
*/
        self.addLoader("sourcemint", true, function(options) {
            var path = PATH.join(self.path, ".sourcemint", "source.json");
            if (!PATH.existsSync(path)) return false;
            return JSON.parse(FS.readFileSync(path));
        });

        self.addLoader("git", false, function(options) {
            return SM_PM.forPackagePath(self.path, pm).then(function(pm) {
                return pm.status({
                    name: self.name,
                    private: (self.status.descriptor && self.status.descriptor.private) || false,
                    versionSelector: self.status.locator.viaVersion || self.status.locator.location,
                    now: options.now,
                    verbose: options.verbose,
                    pm: "git"
                });
            }).then(function(gitInfo) {
                if (gitInfo.type !== "git") return false;
                delete gitInfo.type;
                return gitInfo;
            });
        });

        self.addLoader("npm", false, function(options) {                
            if ((self.status.descriptor && self.status.descriptor.private === true) || !self.name) {
                return false;
            }
            return SM_PM.forPackagePath(self.path, pm).then(function(pm) {

                var fetchedNow = false;

                function fetch(refetch) {
                    var now = options.now;
                    time = options.time;
                    if (refetch) {
                        // We are asked to refetch info now due to newer version installed
                        // than available. Rather than fetching info every time we cache it for today.
                        var timeNow = new Date();
                        time = new Date(timeNow.getFullYear(), timeNow.getMonth(), timeNow.getDate()).getTime();
                        now = true;
                    }
                    if (now) fetchedNow = true;
                    return pm.status({
                        name: self.name,
                        private: (self.status.descriptor && self.status.descriptor.private) || false,
                        versionSelector: self.status.locator.viaVersion || self.status.locator.location,
                        now: now,
                        time: time,
                        verbose: options.verbose,
                        pm: "npm",
                        includeDescriptor: true
                    });
                }

                return fetch().then(function(info) {
                    // If already fetched latest info now we are done.
                    if (fetchedNow) return info;
                    // If not published or using latest version we are done.
                    if (!info.published || info.usingLatest) return info;
                    if (typeof info.actualVersion === "undefined") {
                        // Not installed.
                        return info;
                    }
                    // Check if installed version is newer than latest.
                    if (SEMVER_NPM.compare(info.actualVersion, info.latestVersion) > 0) {
                        // Latest info is out of date! Re-fetch.
                        return fetch(true);
                    }
                    return info;
                });
            });
        });
    }
    Node.prototype = new BaseNode();
    Node.prototype.initForPath = function(path) {
        var self = this;
        var deferred = Q.defer();
        self.exists = false;
        self.path = path;
        PATH.exists(path, function(exists) {
            Q.call(function() {
                if (!exists) {
                    return deferred.resolve();
/*                    
                    function findInParent(node) {                    
                        if (!node) return Q.ref();
                        if (node.children[self.name]) {
                            var deferred = Q.defer();
                            PATH.exists(node.children[self.name].path, function(exists) {
                                if (exists) {
                                    self.path = node.children[self.name].path;
                                    deferred.resolve();
                                } else {
                                    findInParent(node.parent).then(deferred.resolve, deferred.reject);
                                }
                            })
                            return deferred.promise;
                        }
                    }
                    return findInParent(self.parent && self.parent.parent);
*/
                }
            }).then(function() {
                var deferred = Q.defer();
                PATH.exists(self.path, function(exists) {
                    if (!exists) return deferred.resolve();
                    self.exists = true;
                    return Q.ninvoke(FS, 'realpath', self.path).then(function(path) {
                        self.path = path;
                        return DESCRIPTORS.packageForPath(self.path).then(function(descriptor) {
                            self.status.descriptor = descriptor.json;
                        });
                    }).then(deferred.resolve, deferred.reject);
                });
                return deferred.promise;
            }).then(deferred.resolve, deferred.reject);
        });
        return Q.when(deferred.promise, function() {

            if (!self.parent) return;

            function findDependency(dependencies) {
                if (Array.isArray(dependencies)) {
                    for (var i=0 ; i<dependencies.length ; i++) {
                        if (dependencies[i] === self.name) {
                            // Found but no version specified.
                            return true;
                        }
                    }
                } else {
                    for (var key in dependencies) {
                        if (key === self.name) {
                            return dependencies[key];
                        }
                    }
                }
                return false;
            }
            function normalizeMappingLocator(locator) {
                if (UTIL.isArrayLike(locator.viaSelector)) {
                    locator.pm = locator.viaSelector[0];
                    locator.location = locator.viaSelector[1];
                    var locationInfo = URI_PARSER.parse(locator.location);
                    if (locationInfo && locationInfo.vendor && locationInfo.vendor.rev) {
                        locator.version = locationInfo.vendor.rev;
                    }
                    locator.descriptorOverlay = locator.viaSelector[2] || false;
                } else {
                    locator.pm = "sm";
                    locator.location = locator.viaSelector;
                    var locationInfo = URI_PARSER.parse(locator.location);
                    if (locationInfo && locationInfo.vendor && locationInfo.vendor.rev) {
                        locator.version = locationInfo.vendor.rev;
                    }
                    locator.descriptorOverlay = false;
                }
            }
            function normalizeDependencyLocator(locator) {
                if (locator.viaSelector === "latest") {
                    locator.viaSelector = "*";
                }
                if (SEMVER_NPM.validRange(locator.viaSelector) !== null) {
                    // We have a URI.
                    locator.viaVersion = locator.viaSelector;
                    if (SEMVER_NPM.valid(locator.viaSelector) !== null) {
                        locator.version = locator.viaVersion;
                    }
                } else {
                    // We have a simple version.
                    locator.location = locator.viaSelector;
                    var locationInfo = URI_PARSER.parse(locator.location);
                    if (locationInfo && locationInfo.vendor && locationInfo.vendor.rev) {
                        locator.version = locationInfo.vendor.rev;
                    }
                }
            }

            var locator = {};

            if (self.parent.status.descriptor.mappings && (locator.viaSelector = findDependency(self.parent.status.descriptor.mappings))) {
                locator.viaPm = "sm";
                locator.viaAttribute = "mappings";
                normalizeMappingLocator(locator);
            } else
            if (self.parent.status.descriptor.devMappings && (locator.viaSelector = findDependency(self.parent.status.descriptor.devMappings))) {
                locator.viaPm = "sm";
                locator.viaAttribute = "devMappings";
                normalizeMappingLocator(locator);
            } else
            if (self.parent.status.descriptor.dependencies && (locator.viaSelector = findDependency(self.parent.status.descriptor.dependencies))) {
                locator.viaPm = "npm";
                locator.pm = "npm";
                locator.viaAttribute = "dependencies";
                normalizeDependencyLocator(locator);
            } else
            if (self.parent.status.descriptor.devDependencies && (locator.viaSelector = findDependency(self.parent.status.descriptor.devDependencies))) {
                locator.viaPm = "npm";
                locator.pm = "npm";
                locator.viaAttribute = "devDependencies";
                normalizeDependencyLocator(locator);
            }
            if (self.parent.status.descriptor.bundleDependencies && findDependency(self.parent.status.descriptor.bundleDependencies)) {
                locator.viaPm = "npm";
                locator.pm = "npm";
                locator.bundled = true;
            }
            self.status.locator = locator;
        });
    }
    Node.prototype.initForLegacy = function(pkgInfo, context) {
        // TODO: Remove this once it is not used above any more.
        this.legacy = [pkgInfo, context];
        this.name = UTIL.unique(pkgInfo[2])[0];
        this.level = context.level;
        this.path = pkgInfo[0].path;
    }
    Node.prototype.addLoader = function(type, waitFor, loader) {
        this.loaders[type] = [waitFor, loader];
    }
    Node.prototype.toString = function() {
        var str = this.level + " : " + this.name + " (" + UTIL.len(this.children) + ")";
        if (this.status.summary && this.status.summary.installed) {
            if (this.status.git) {
                str += " git";
            }
            if (this.status.npm) {
                str += " npm:" + this.status.summary.version;
            }
            if (this.status.summary) {
                if (this.status.summary.newInSelectorVersion) {
                    str += " (update: " + this.status.summary.newInSelectorVersion + ")";
                }
                if (this.status.summary.newOutSelectorVersion) {
                    str += " (upgrade: " + this.status.summary.newOutSelectorVersion + ")";
                }
            }
        } else {
            str += " missing";
        }
        str += "\n";
        UTIL.forEach(this.children, function(child) {
            var parts = child[1].toString().split("\n").map(function(line) {
                return "    " + line;
            });
            str += "    " + parts.splice(0, parts.length-1).join("\n") + "\n";
        });
        return str;
    }
    Node.prototype.refresh = function(options, refreshedPackages) {
        var self = this;
        options = options || {};

        refreshedPackages = refreshedPackages || {};
        if (refreshedPackages[self.path]) {
            self.circular = refreshedPackages[self.path];
            return Q.ref();
        }
        refreshedPackages[self.path] = self;

        var deferred = Q.defer();
        var nodeChanges = {};
        var waitForLoaders = WAIT_FOR.makeParallel(function(err) {
            if (err) return deferred.reject(err);
            self.emit("updated-node", nodeChanges);
            deferred.resolve(nodeChanges);
        });
        // Traverse all loaders for node.
        var queue = Q.ref();
        UTIL.forEach(self.loaders, function(loader) {

            waitForLoaders(function(done) {
                try {
                    function callLoader() {

                        return Q.call(function() {

                            if (options.verbose) {
                                console.log("Call loader '" + loader[0] + "' for package: " + self.path);
                            }

                            return Q.when(loader[1][1](options), function(data) {

                                if (options.verbose) {
                                    console.log("Done: loader '" + loader[0] + "' for package: " + self.path);
                                }

                                if (!data) return;

                                if (!self.status[loader[0]]) self.status[loader[0]] = {};

                                // Determine properties that have actually changed.
                                var changes = {};

                                changes[[loader[0]]] = UTIL.deepDiff(data, self.status[loader[0]]);

                                if (UTIL.len(changes[loader[0]]) === 0) return;

                                nodeChanges[loader[0]] = changes[loader[0]];

                                UTIL.deepUpdate(self.status[loader[0]], changes[loader[0]]);

//                                self.emit("updated-status", changes);
                            });
                        }).fail(function(err) {
                            if (err !== true) {
                                console.error("ERROR: Loader for type '" + loader[0] + "' failed with error: " + (err.stack || err.message));
                            }
                            return err;
                        });
                    }
                    if (loader[1][0]) {
                        queue = Q.when(queue, function() {
                            return callLoader().then(function() {
                                done();
                            }).fail(done);
                        });
                    } else {
                        Q.when(queue, function() {
                            callLoader().then(function() {
                                done();
                            }).fail(done);
                        });
                    }
                } catch(err) {
                    done(err);
                }
            });
        });
        waitForLoaders();

        return Q.when(deferred.promise, function() {

            if (!self.exists) {
                return;
            }
            // We can skip some common core packages as they use a shrinkwrap file and should never have outdated dependencies.
            if (!/^sourcemint-|^sm$/.test(pm.context.program.package.descriptor.json.name) && /^sourcemint-/.test(self.name)) {
                return;
            }
            if (self.name === "npm") {
                return;
            }

            if (self.level === 1 && options.all !== true) return;

            var packages = {};
            function addPackagesForAttribute(attribute) {
                var dir = "mapped_packages";
                if (/dependencies/i.test(attribute)) dir = "node_modules";
                var dependencies = self.status.descriptor[attribute];
                if (!dependencies) return;
                if (Array.isArray(dependencies)) {
                    for (var i=0 ; i<dependencies.length ; i++) {
                        packages[dependencies[i]] = [attribute, dir];
                    }
                } else {
                    for (var key in dependencies) {
                        if (Array.isArray(dependencies[key]) && dependencies[key][0] === "npm") {
                            dir = "node_modules";
                        }
                        packages[key] = [attribute, dir];
                    }
                }
            }
            addPackagesForAttribute("mappings")
            addPackagesForAttribute("dependencies")
            addPackagesForAttribute("devMappings")
            addPackagesForAttribute("devDependencies")
            addPackagesForAttribute("bundleDependencies")

            var deferred = Q.defer();

            var waitForDir = WAIT_FOR.makeParallel(function(err) {
                if (err) return deferred.reject(err);

                var queue = Q.ref();
                UTIL.forEach(packages, function(name) {
                    if (!self.children[name[0]]) {
                        if (
                            options.dev !== true &&
                            /^dev/.test(packages[name[0]][0])
                        ) return;
                        queue = Q.when(queue, function() {
                            var node = new Node(name[0], self.level + 1);
                            node.parent = self;
                            self.children[name[0]] = node;
                            return node.initForPath(PATH.join(self.path, packages[name[0]][1], name[0])).then(function() {
                                return node.refresh(options, refreshedPackages);
                            });
                        });
                    }
                });
                Q.when(queue, deferred.resolve, deferred.reject);
            });
            [
                "node_modules",
                "mapped_packages"
            ].forEach(function(dir) {
                waitForDir(PATH.join(self.path, dir), function(basePath, done) {
                    PATH.exists(basePath, function(exists) {
                        if (!exists) return done();
                        FS.readdir(basePath, function(err, basenames) {
                            if (err) return done(err);
                            var waitForPackage = WAIT_FOR.makeParallel(function(err) {
                                if (err) return done(err);
                                done();
                            });
                            basenames.forEach(function(basename) {
                                if (/~backup-/.test(basename)) return;
                                if (/^\./.test(basename)) return;
                                if (!self.children[basename]) {
                                    waitForPackage(function(done) {
                                        if (
                                            options.dev !== true &&
                                            packages[basename] &&
                                            /^dev/.test(packages[basename][0])
                                        ) return done();
                                        var deferred = Q.defer();
                                        var path = PATH.join(basePath, basename);
                                        PATH.exists(path, function(exists) {
                                            if (!exists) {
                                                // We have a symlink pointing to a package that does not yet exist.
                                                // We queue this package to be loaded after all dependencies
                                                // from package.json have been installed as it is assumed the symlink
                                                // points to a package deeper in another dependency.

console.log("PATH", path);

deferred.resolve();
                                            } else {
                                                FS.lstat(path, function(err, stats) {
                                                    if (err) return deferred.reject(err);
                                                    if (!stats.isDirectory() && !stats.isSymbolicLink()) return deferred.resolve();
                                                    delete packages[basename];
                                                    var node = new Node(basename, self.level + 1);
                                                    node.parent = self;
                                                    node.isSymlinked = stats.isSymbolicLink();
                                                    self.children[basename] = node;
                                                    node.initForPath(path).then(function() {
                                                        return node.refresh(options, refreshedPackages);
                                                    }).then(deferred.resolve, deferred.reject);
                                                });
                                            }
                                        });
                                        Q.when(deferred.promise, done, done);
                                    });
                                }
                            });
                            waitForPackage();
                        });
                    });
                });
            });
            waitForDir();
            return deferred.promise;
        });
    }

    var tree = new Node(pm.context.program.package.name);
    return tree.initForPath(pm.context.program.package.path).then(function() {
        return tree.refresh(options);
    }).then(function() {
        return tree;
    });
}

