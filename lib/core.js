
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("graceful-fs");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const Q = require("sourcemint-util-js/lib/q");
const WAIT_FOR = require("sourcemint-util-js/lib/wait-for");
const PACKAGES = require("sourcemint-pinf-js/lib/packages");
const DESCRIPTORS = require("sourcemint-pinf-js/lib/descriptors");
const SEMVER = require("sourcemint-pinf-js/lib/semver");
const SEMVER_NPM = require("semver");
const EVENTS = require("events");
const URI_PARSER = require("./uri-parser");
const PACKAGE = require("./package");
const LOCATOR = require("./locator");
const SM_PM = require("./pm");



var BaseNode = function() {
    this.name = null;
    this.path = null;
    this.level = 0;
    this.children = {};
    this.parent = null;
}
BaseNode.prototype = new EVENTS.EventEmitter();
BaseNode.prototype.forEachReadyNodeRecursive = function(callback) {
    var self = this;
    return ((self.ready)?self.ready.then:Q.call)(function() {
        return Q.when(callback(self), function(oo) {
            if (oo === false) return;
            if (self.circular) return;
            return self.forEachReadyChildRecursive(callback);
        });
    }).fail(function(err) {
        err.message += " (package: " + self.path + ")";
        throw err;
    });
}
BaseNode.prototype.forEachReadyChildRecursive = function(callback) {
    var self = this;
    var done = Q.ref();
    UTIL.forEach(self.children, function(child) {
        done = Q.when(done, function() {
            return child[1].forEachReadyNodeRecursive(callback);
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
    if (!self.parent) return Q.ref();
    return Q.call(function() {
        return Q.when(callback(self.parent, level), function() {
            return self.parent.forEachParent(callback, level);
        });
    });
}



exports.getStatusTree = function(pm, options) {

    var originalOptions = options;

    var Node = function(node, parent) {
        this.package = null;
        this.parent = parent || null;
        this.stickies = null;   // Only set on top-level package.
        this.children = {};
        this.status = {};
        if (node) this.initFromFsNode(node);
    }
    Node.prototype = new BaseNode();
    Node.prototype.initFromFsNode = function(node) {
        var self = this;

        if (options.debug) console.log("[sm] Trigger initFromFsNode for node: " + node.path);

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

        // "mappings": { "alias": "." }
        if (self.status.locator && self.status.locator.pointer === ".") {
            self.status.locator = self.parent.status.locator;
        }

        if (self.status.descriptor) {
            if (self.status.descriptor.catalog && self.status.descriptor.shrinkwrap) {
                TERM.stdout.writenl("");
                TERM.stdout.writenl("\0red([sm] ERROR: You cannot set both `catalog: true` and `shrinkwrap: true` in '" + PATH.join(self.path, "package.json") + "'. Pick one!.\0)");
                TERM.stdout.writenl("");
                throw true;
            }
            if (self.status.descriptor.catalog && self.status.descriptor.pm !== "sm") {
                TERM.stdout.writenl("");
                TERM.stdout.writenl("\0red([sm] ERROR: If you set `catalog: true` in '" + PATH.join(self.path, "package.json") + "' you must also set `pm: \"sm\"`!.\0)");
                TERM.stdout.writenl("");
                throw true;
            }
        }

        // TODO: Relocate this to `info` in `assemble()` below.
        if (self.status.git) {
            self.status.vcs = {};
            if (self.status.git.writable) {
                self.status.vcs.mode = "write";
            } else {
                self.status.vcs.mode = "read";
            }
        }
    }
    // `context` is used only while traversing.
    // `inheritedStatus` is stored at `self.status.inheritedStatus`.
    Node.prototype.assemble = function(context, inheritedStatus, ourOptions) {
        var self = this;

        var options = ourOptions || originalOptions;

        if (options.debug) console.log("[sm] Trigger assemble for node: " + self.path);

        if (self.level === 0) {
            context = {
                lastPackageByName: {}
            };
            context.lastPackageByName[self.name] = [
                self.fsNode
            ];
            inheritedStatus = {
                topSticky: false,
                vcs: false
            };
        }

        context = UTIL.copy(context);
        var lastPackageByName = {};
        UTIL.forEach(context.lastPackageByName || {}, function(node) {
	        lastPackageByName[node[0]] = UTIL.copy(context.lastPackageByName[node[0]]);
        });
        context.lastPackageByName = lastPackageByName;
        self.context = context;

        var inParent = false;

        if (self.circular) {
            var circular = self.circular;
            if (options.debug) console.log("[sm] Init from circular node '" + circular.path + "' for node: " + self.path);
            self.initFromFsNode(circular);
            self.circular = circular;
        } else
        if (!self.status.descriptor && context.lastPackageByName[self.name]) {
            for (var i=context.lastPackageByName[self.name].length-1; i>=0 ; i--) {
                if (context.lastPackageByName[self.name][i].status.descriptor) {
                    if (options.debug) console.log("[sm] Init from parent fs node '" + context.lastPackageByName[self.name][i].path + "' for node: " + self.path);
                    self.initFromFsNode(context.lastPackageByName[self.name][i]);
					inParent = self.level - context.lastPackageByName[self.name][i].level;
                    break;
                }
            }
        }


        var Stickies = function(tree) {
            this.tree = tree;
            this.path = PATH.join(this.tree.path, "sm-catalog.json");
            this.packages = {};
            // Inherit saved state from previous instance as we get a new instance for every refresh.
            this.saved = (this.tree.stickies && this.tree.stickies.saved) || false;
        }
        Stickies.prototype.addPackages = function(packages) {
            // Existing packages (from higher up in the tree) are king.
            packages = UTIL.deepCopy(packages);
            var existingPackages = this.packages;
            UTIL.update(packages, existingPackages);
            this.packages = packages;
        }
        Stickies.prototype.isSticky = function(info) {
            if (!this.packages[info.relpath]) return false;
            return this.packages[info.relpath];
        }
        Stickies.prototype.updatePackage = function(info) {
            if (!info.locator) return Q.ref();
            var locator = {
                location: info.locator.toUniqueIdentityObject().location
            };
            if (this.packages[info.relpath] && UTIL.deepEqual(this.packages[info.relpath], locator)) {
                return Q.ref();
            }
            this.packages[info.relpath] = locator;
            return this.save();
        }
        Stickies.prototype.save = function() {
            var self = this;
            return Q.call(function() {
                if (!self.tree.status.descriptor.catalog) {
                    return false;
                }
                var catalog = {
                    "#": "To update this file, modify package.json files, commit, and run: `sm update`",
                    packages: {}
                };
                return self.tree.forEachReadyNodeRecursive(function(node) {
                    if (node.level === 0) return true;
                    catalog.packages[node.package.relpath] = {
                        location: node.package.locator.toUniqueIdentityObject().location
                    };
                    return true;
                }).then(function() {
                    var deferred = Q.defer();                    
                    catalog = JSON.stringify(catalog, null, 4);
                    PATH.exists(self.path, function(exists) {
                        function writeFile() {
                            FS.writeFile(self.path, catalog, function(err) {
                                if (err) return deferred.reject(err);
                                self.saved = true;
                                deferred.resolve(true);
                            });
                        }
                        if (exists) {
                            FS.readFile(self.path, function(err, data) {
                                if (err) return deferred.reject(err);
                                if (data.toString() === catalog) {
                                    return deferred.resolve(false);
                                }
                                writeFile();
                            });
                        } else {
                            writeFile();
                        }
                    });
                    return deferred.promise;
                });
            });
        }

        var stickyPackages = {};
        if (self.status["sm-catalog"] && self.status["sm-catalog"].packages) {
            if (self.status["npm-shrinkwrap"]) {
                TERM.stdout.writenl("");
                TERM.stdout.writenl("\0red([sm] ERROR: Found '" + PATH.join(self.path, "sm-catalog.json") + "' and '" + PATH.join(self.path, "npm-shrinkwrap.json") + "'. You can only have one of these files!\0)");
                if (self.status.descriptor.catalog) {
                    TERM.stdout.writenl("\0red([sm] ERROR: You have `catalog: true` set in '" + PATH.join(self.path, "package.json") + "' so delete '" + PATH.join(self.path, "npm-shrinkwrap.json") + "'.\0)");
                } else
                if (self.status.descriptor.shrinkwrap) {
                    TERM.stdout.writenl("\0red([sm] ERROR: You have `shrinkwrap: true` set in '" + PATH.join(self.path, "package.json") + "' so delete '" + PATH.join(self.path, "sm-catalog.json") + "'.\0)");
                }
                TERM.stdout.writenl("");
                throw true;
            }
            stickyPackages = self.status["sm-catalog"].packages;
        } else
        if (self.status["npm-shrinkwrap"]) {
            function processLevel(dependencies, basePath) {
                for (var name in dependencies) {
                    var path = PATH.join(basePath, name);
                    // `from` is more deterministic than `version`.
                    if (dependencies[name].from) {
                        stickyPackages[path] = {
                            location: dependencies[name].from
                        };
                    } else {
                        stickyPackages[path] = {
                            version: dependencies[name].version
                        };
                    }
                    if (dependencies[name].dependencies) {
                        processLevel(dependencies[name].dependencies, PATH.join(path, "node_modules/"));
                    }
                }
            }
            if (self.status["npm-shrinkwrap"].dependencies) {
                processLevel(self.status["npm-shrinkwrap"].dependencies, "node_modules/");
            }
        }
        if (self.level === 0) {
            self.stickies = context.stickies = new Stickies(self);
            if (self.status.descriptor.catalog) {
                inheritedStatus.topSticky = true;
            }
        }
        if (UTIL.len(stickyPackages) > 0) {
            context.stickies.addPackages(stickyPackages);
            if (self.level === 0) {
                inheritedStatus.topSticky = true;
            }
        }


        if (options.debug) console.log("[sm] self.status before info assemble for node: " + self.path);
        if (options.debug) console.log(self.status);

        // Summarize status data.
        self.status.status = info = {
            name: self.name,
            relpath: "",
            level: self.level,
            path: self.path,
            dir: self.fsNode.dir || false,
            symlinked: self.fsNode.isSymlinked || false,
            inParent: inParent,
            version: (self.status.descriptor && self.status.descriptor.version) || false,
            declared: false,
            bundled: false,
            pm: false,
            locator: false,
            installed: !!self.status.descriptor,
            locked: false,
            sticky: false,
            newLocator: false,
            newLockedLocator: false,
            newStickyLocator: false,
            newInLocator: false,
            newOutLocator: false,
            platformName: false,
            platformVersion: false,
            newPlatformVersion: false,
            vcs: false,
            git: false,
            scripts: (self.status.descriptor && self.status.descriptor.scripts) || false,
            directories: (self.status.descriptor && self.status.descriptor.directories) || {}
        };
        if (typeof info.directories.lib === "undefined") {
            info.directories.lib = "lib";
        }
/*        
        if (info.symlinked === "outside" || (inheritedStatus && inheritedStatus.symlinked === "outside")) {            
            info.relpath = "";
        } else
*/
        if (self.parent) {
            info.relpath = PATH.join(self.parent.status.status.relpath, info.dir, info.name);
        }
        if (self.status.locator || info.symlinked === "inside") {
            info.declared = true;
            if (self.status.locator.bundled) {
                info.bundled = true;
            }
        }
        // TODO: `self.status.locator` should not have `pm` set if not declared in locator. i.e. don't default to `sm`.
        if (self.status.locator && typeof self.status.locator.pm !== "undefined") {
            info.pm = self.status.locator.pm;
        } else
        if (self.status.locator && self.status.locator.descriptorOverlay && typeof self.status.locator.descriptorOverlay.pm !== "undefined") {
            info.pm = self.status.locator.descriptorOverlay.pm;
        } else
        if (self.status.descriptor && typeof self.status.descriptor.pm !== "undefined") {
            info.pm = self.status.descriptor.pm;
        }
        // We default to the NodeJS platform.
        // TODO: Determine platform based on program and package descriptors. Program descriptor should declare
        //       (<commonName>: <version>|<sourcemintPlatformUri>) platforms to be used while
        //       package descriptors via engines[<commonName>] should declare compatibility.
        info.platformName = "node";
        info.platformVersion = process.version;
        if (self.status.sourcemint && self.status.sourcemint.platformVersion) {
            info.platformVersion = self.status.sourcemint.platformVersion;
            if (info.platformVersion !== process.version) {
                info.newPlatformVersion = process.version;
            }
        }
        if ((self.status.locator && self.status.locator.pm === "npm") || (self.status.npm && self.status.npm.published)) {
            // TODO: Deprecate.
            info.npm = true;
        }
        if (self.status.git) {
            info.git = self.status.git;
        }
        if (self.status.vcs) {
            info.vcs = self.status.vcs;
        }
        function repositoryFromDescriptor(descriptor) {
            var repositories = descriptor.repository || descriptor.repositories || false;
            if (repositories && !UTIL.isArrayLike(repositories)) {
                repositories = [ repositories ];
            }
            var url = false;
            if (repositories) {
                var repository = repositories[0];
                var url = false;
                if (typeof repository === "string") {
                    url = repository;
                } else
                if(typeof repository === "object" && repository.url) {
                    url = repository.url;
                }
            }
            try {
                var parsedUrl = URI_PARSER.parse(url);
                if (parsedUrl && parsedUrl.uris && parsedUrl.uris.homepage) {
                    url = parsedUrl.uris.homepage;
                }
            } catch(err) {}
            return url;
        }
        info.repositoryUri = false;
        if (self.status.descriptor) {
            info.repositoryUri = repositoryFromDescriptor(self.status.descriptor);
        }
        if (!info.repositoryUri && self.status.npm && self.status.npm.descriptor) {
            info.repositoryUri = repositoryFromDescriptor(self.status.npm.descriptor);
        }
        if (self.status.descriptor && self.status.descriptor.homepage) {
            info.homepageUri = self.status.descriptor.homepage;
        }


        // Resolve various things.

        self.ready = Q.ref();

        self.ready = Q.when(self.ready, function() {
            if (self.status.sourcemint && self.status.sourcemint.locator) {
                return LOCATOR.for(pm, self.status).fromObject(self.status.sourcemint.locator);
            } else
            if (self.status.descriptor && self.status.descriptor._id && self.status.descriptor._from) {
                // `_id` contains `<name>@<version>`
                // `_from` contains `<name>@<selector>`
                return LOCATOR.for(pm, self.status).fromObject({
                    version: self.status.descriptor._id.replace(/^[^@]*@/,"") || "*",
                    pointer: self.status.descriptor._from.replace(/^[^@]*@/,"") || "*"
                });
            } else
            if (info.version) {
                return LOCATOR.for(pm, self.status).fromObject({
                    version: info.version
                });
            }
        }).then(function(locator) {
            info.locator = locator || false;
            if (options.updated && options.refresh && self.level > 0) {
                return context.stickies.updatePackage(info);
            }
        });

        // TODO: Set `info.newLockedLocator`.

        self.ready = Q.when(self.ready, function() {
            if (context.stickies.isSticky(info)) {
                info.sticky = true;
                return LOCATOR.for(pm, self.status).fromObject(context.stickies.isSticky(info)).then(function(locator) {
                    if (locator.equals(info.locator)) {
                        return false;
                    }
                    return locator;
                }).then(function(locator) {
                    info.newStickyLocator = locator;
                });
            }
        });

        var latestLocator = null;
        self.ready = Q.when(self.ready, function() {
            return LOCATOR.for(pm, self.status).fromObject(self.status.locator || {}).then(function(locator) {

                if (locator.location === false && self.level === 0) {
                    // We have the top level package which is not declared via a locator.
                } else
                if (locator.location === false && self.status.status.symlinked) {
                    // We have a linked in dependency that is not declared via a locator.
                } else
                if (locator.location === false && info.declared && info.bundled) {
                    // We have a bundled package.
                } else
                if (locator.location === false && !info.declared) {
                    // We have an extra package that is not declared via a locator.
                } else {

                    latestLocator = locator;

                    function compare() {
//console.log("COMP", self.name, info.locator, locator);
                        if (locator.equals(info.locator) === false) {
                            info.newInLocator = locator;
                        }
                    }
                    // Make a new locator for our current install that includes the selector from the parent.
                    if (!info.locator) {
                        // Just set selector without fetching latest version.
                        return LOCATOR.for(pm, self.status).straightFromObject({
                            selector: locator.selector || undefined
                        }).then(function(locator) {
                            info.locator = locator;
                            return compare();
                        });
                    }
                    var identity = info.locator.toRawIdentityObject();
                    identity.selector = locator.selector || undefined;
                    return LOCATOR.for(pm, self.status).fromObject(identity).then(function(locator) {
                        info.locator = locator;
                        return compare();
                    });
                }
            });
        });

        self.ready = Q.when(self.ready, function() {
            return LOCATOR.for(pm, self.status).fromObject({
                selector: "*"
            }).then(function(locator) {
                if (info.locator && locator.equals(info.locator) === false) {
                    if (info.newInLocator && locator.equals(info.newInLocator) === false) {
                        info.newOutLocator = locator;
                    } else
                    if (latestLocator && locator.equals(info.newInLocator) === false) {
                        info.newOutLocator = locator;
                    }
                }
            }).then(function() {
                // NOTE: `version` here should never really be false once we always try and fetch new info.
                if (info.newOutLocator.version === false) {
                    info.newOutLocator = false;
                }
            });
        });

        // TODO: Don't wait for `self.ready` here so we can process whole tree while waiting for more info.

        return Q.when(self.ready, function() {

            info.newLocator = info.newLockedLocator || 
                              (!info.locked && info.newStickyLocator) || 
                              (!info.locked && !info.sticky && info.newInLocator) || 
                              ((!info.installed || info.newPlatformVersion) && info.locator);

            if (options.debug) console.log("[sm] info after info assemble for node: " + self.path);
            if (options.debug) console.log(info);

            // Update deep status summary.
            var deepStatus = {
                errors: false,
                missing: false,
                "<undeclared-": false,
                "<undeclared-must": false,
                mustInstall: false,
                mustUpdate: false,
                canUpdate: false,
                "<locked-must": false,
                "<sticky-": false,
                "<sticky-must": false,
                "<new-": false,
                "<new-must": false,
                "<platform-must": false,
                "<out(top)-": false,
                "<out(transitive)-": false,
                newLocator: false,
                newOutLocator: false,
                dirty: false,
                behind: false,
                ahead: false,
                vcs: false
            };
            if (!info.installed) {
                deepStatus.errors = true;
                deepStatus.missing = true;
                deepStatus.mustInstall = true;
            }
            if (!info.declared && info.level > 0) {
                if (inheritedStatus.topSticky) {
                    deepStatus.errors = true;
                    deepStatus["<undeclared-must"] = true;
                } else {
                    deepStatus["<undeclared-"] = true;
                }
            }
            if (info.newLocator) {
                deepStatus.newLocator = true;
                if (info.newLocator === info.newLockedLocator) {
                    deepStatus.errors = true;
                    deepStatus.mustInstall = true;
                    deepStatus["<locked-must"] = true;
                } else
                if (info.newLocator === info.newStickyLocator) {
                    deepStatus.errors = true;
                    deepStatus.mustInstall = true;
                    deepStatus["<sticky-must"] = true;
                } else
                if (info.newLocator === info.newInLocator) {
                    deepStatus.errors = true;
                    deepStatus.mustUpdate = true;
                    deepStatus["<new-must"] = true;
                } else
                if (info.newLocator === info.locator && info.newPlatformVersion) {
                    deepStatus.errors = true;
                    deepStatus.mustInstall = true;
                    deepStatus["<platform-must"] = true;
                }
            }
            if (info.locked && info.newStickyLocator) {
                deepStatus["<sticky-"] = true;
            }
            if (info.sticky && info.newInLocator) {
                deepStatus["<new-"] = true;
                deepStatus.canUpdate = true;
                if (!info.newLocator) {
                    info.newLocator = info.newInLocator;
                }
            } else
            if (info.newInLocator && info.newInLocator.version === info.newInLocator.selector) {
                deepStatus.mustInstall = true;
            }
            if (info.newOutLocator) {
                deepStatus.newOutLocator = true;
                if (self.level <= 1) {
                    deepStatus["<out(top)-"] = true;
                } else {
                    deepStatus["<out(transitive)-"] = true;
                }
            }
            if (info.vcs) {
                deepStatus.vcs = true;
            }
            if (info.git && (info.git.dirty || info.git.behind || info.git.ahead)) {
                deepStatus.errors = true;
                deepStatus.dirty = info.git.dirty;
                deepStatus.behind = info.git.behind;
                deepStatus.ahead = info.git.ahead;
            }

            self.status.status.mustInstall = deepStatus.mustInstall;
            self.status.status.mustUpdate = deepStatus.mustUpdate;
            self.status.status.canUpdate = deepStatus.canUpdate;


            function updateDeepStatusForChild(deepStatus, node) {
                for (var name in node.status.deepStatus) {
                    if (node.status.deepStatus[name]) {
                        deepStatus[name] = node.status.deepStatus[name];
                    }
                }
            }
            var ourDeepStatus = UTIL.copy(deepStatus);
            self.bubbleDeepStatusUpdate = function() {
                var deepStatus = UTIL.copy(ourDeepStatus);
                UTIL.forEach(self.children, function(child) {
                    updateDeepStatusForChild(deepStatus, child[1]);
                });
                self.status.deepStatus = deepStatus;
                if (!self.parent) return;
                self.parent.bubbleDeepStatusUpdate();
            }


            // Update inherited status summary.
            self.status.inheritedStatus = inheritedStatus;
            inheritedStatus = UTIL.copy(inheritedStatus);
            if (self.level > 0) {
                if (self.status.status.vcs) {
                    inheritedStatus.vcs = self.status.status.vcs;
                }
                if (self.status.status.symlinked) {
                    inheritedStatus.symlinked = self.status.status.symlinked;
                }
            }


            var deferred = Q.defer();

            // Traverse children.


            self.children = {};
            UTIL.forEach(self.fsNode.children, function(child) {
                var node = new Node(child[1], self);
                self.children[child[0]] = node;
                if (!context.lastPackageByName[child[0]]) {
                    context.lastPackageByName[child[0]] = [];
                }
                context.lastPackageByName[child[0]].push(node);
            });
            // Sort children.
            var names = Object.keys(self.children);
            names.sort();
            var oldChildren = self.children;
            self.children = {};
            names.forEach(function(name) {
                self.children[name] = oldChildren[name];
            });
            delete oldChildren;


//            if (options.debug) console.log("[sm] deepStatus before children for node: " + self.path);
//            if (options.debug) console.log(deepStatus);


            var waitFor = WAIT_FOR.makeSerial(function(err) {
                if (err) return deferred.reject(err);
                self.status.deepStatus = deepStatus;

//                if (options.debug) console.log("[sm] deepStatus after children for node: " + self.path);
//                if (options.debug) console.log(deepStatus);

                deferred.resolve();
            });
            UTIL.forEach(self.children, function(child) {
                waitFor(function(done) {
                    Q.when(child[1].assemble(context, inheritedStatus, options), function() {
                        updateDeepStatusForChild(deepStatus, child[1]);
                        done();
                    }, done);
                });
            });
            waitFor();


            if (!self.refresh) {
            	self.refresh = function(options) {

                    var opts = UTIL.copy(options);

                    if (opts.debug) console.log("[sm] Trigger refresh for node: " + self.path);

                    opts.refresh = true;

            		var fsNode = self.fsNode;
            		return fsNode.initForPath(fsNode.path).then(function() {                        
    	        		return fsNode.refresh(opts).then(function() {
    	        			self.fsNode = null;
                            var inheritedStatus = self.status.inheritedStatus;
    	        			self.initFromFsNode(fsNode);
                            var context = UTIL.copy(self.context);
                            if (options.skipParentLookup) {
                                context.lastPackageByName = {};
                            }
    		        		return self.assemble(context, inheritedStatus, opts).then(function() {
    							// Now that this node and its children have been updated we need to update
    							// the deep status in the parents.
                                if (self.parent) {
        							self.parent.bubbleDeepStatusUpdate();
                                }
    						});
    	        		});
            		});
            	}
            }

            return deferred.promise;
        }).then(function() {
            self.package = PACKAGE.forNode(pm, self);
        }, function(err) {
            err.message += " (package: " + self.path + ")";
            throw err;
        });
    }
    Node.prototype.print = function(options) {
        var node = this;
        var info = node.status.status;

/*
if (info.name === "asyncjs") {
    console.log(this.status.locator);
    console.log(info);
}
*/

        options = options || {};

        // Generate output.
        // TODO: Move most of this into package so package can pretty-print anywhere.

        var line = [];

        var padding = "  ";
        if (options.mode === "tree") {
            for (var i=0 ; i<=node.level ; i++) padding += "  ";
        } else {
            line.push("[sm]");
            padding += "  ";
        }
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

        line.push("\0" + ((info.installed)?"yellow":"red") + "(" + ((node.level <= 1)?("\0bold(" + info.name + "\0)"):info.name));
        line.push(((node.status.locator && node.status.locator.viaAttribute && /^dev/.test(node.status.locator.viaAttribute))?"\0cyan(D\0)":"@"));
        var segment = "";
        if (info.installed) {
            if (info.locator) {
                segment = info.locator.toString("minimal");
            } else {
                segment = info.version;
            }
            if (info.locked) {
                if (info.newLockedVersion) {
                    segment += " :";
                } else {
                    segment += " |";
                }
            }
        } else {
            segment = "\0bold(MISSING\0)";
        }
        line.push(segment + "\0)");

        if (node.level > 0 && !info.declared) {
            line.push("\0" + ((node.status.inheritedStatus.topSticky)?"red":"magenta") + "(\0bold(UNDECLARED\0)\0)");
        }

        var ok = (info.installed)?true:false;
        if (info.newLockedLocator) {
            ok = false;
            line.push("\0red(\0bold(<l-\0) " + info.newLockedLocator.toString("minimal") + "\0)");
        } else
        if (info.newStickyLocator) {
            if (info.locked) {
                line.push("\0magenta(<s- " + info.newStickyLocator.toString("minimal") + "\0)");
            } else {
                ok = false;
                line.push("\0red(\0bold(<s-\0) " + info.newStickyLocator.toString("minimal") + "\0)");
                if (info.newInLocator) {
                    line.push("\0magenta(<n- " + info.newInLocator.toString("minimal") + "\0)");
                }
            }
        } else
        if (info.newInLocator) {
            if (info.sticky) {
                line.push("\0magenta(<n- " + info.newInLocator.toString("minimal") + "\0)");
            } else {
                ok = false;
                line.push("\0red(\0bold(<n-\0) " + info.newInLocator.toString("minimal") + "\0)");
            }
        } else
        if (info.newPlatformVersion) {
            ok = false;
            line.push("\0red((" + info.platformName + ": " + info.platformVersion + " <p- " + info.newPlatformVersion + ")\0)");
        }

        if (info.npm) {
            line.push(" \0" + ((ok)?"green":"red") + "(npm");
            if (info.locator && info.locator.selector && info.locator.selector !== info.locator.toString("minimal")) {
                line.push(info.locator.selector);
            }
            if (info.newOutLocator) {
                line.push("\0magenta(" + ((info.level <= 1)?"\0bold(<o-\0)":"<o-") + " " + info.newOutLocator.toString("minimal") + "\0)");
            }
            line.push("\0)");
        }

        if (info.git) {
            line.push(" \0" + ((!(info.git.dirty || info.git.behind || info.git.ahead))?"green":"red") + "(git");
            if (info.git.branch !== "master" && (!info.locator || info.git.rev !== info.locator.version)) {
                if (info.git.branch != info.git.rev) {
                    line.push("\0orange(" + info.git.branch + " - " + info.git.rev + "\0)");
                } else {
                    line.push("\0orange(" + info.git.branch + "\0)");
                }
            } else
            if (!info.locator || info.git.branch !== info.locator.toString("minimal")) {
                line.push(info.git.branch);
            }
            if (info.git.dirty) {
                line.push("\0bold(dirty\0)");
            } else
            if (info.git.behind) {
                line.push("\0bold(behind\0)");
            } else
            if (info.git.ahead) {
                line.push("\0bold(ahead\0)");
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

        if (node.level === 0 && options.mode === "tree") {
            line.push(" (" + node.path + ")");
        } else
        if (info.symlinked) {
            if (info.symlinked === "outside") {
                line.push(" \0cyan(" + node.path + "\0)");
            } else {    // `info.symlinked === "inside"`
                line.push(" \0cyan(./" + node.path.substring(node.parent.path.length + 1) + "\0)");
            }
        } else
        if (node.status.status.inParent) {
            var up = " ";
            for(var i=0;i<node.status.status.inParent;i++) up += "../../";
            line.push(up.substring(0, up.length-1));
        }
        if (options.info || options.mode !== "tree") {
            if (node.status.status.inParent) {
                line.push(" (" + (info.relpath || info.path) + ") ");
            } else {
                line.push(" " + (info.relpath || info.path) + " ");
            }
        }

        if (options.info) {
            if (info.repositoryUri || info.homepageUri) {
                line.push(" \0yellow(" + (info.repositoryUri || info.homepageUri) + "\0) ");
            }
        }

        if (node.status.status.inParent) {
            line = line.map(function(segment) {
                return segment.replace(/\0\w*\(/g, "\0white(");
            });
        }

        if (node.circular) {
            line = line.map(function(segment) {
                return segment.replace(/\0\w*\(/g, "\0white(");
            });
            line = line.slice(0, 4).join(" ") + " \0cyan(\xA4\0)";
        } else {
            line = line.join(" ");
        }

        if (options.mode !== "tree") {
            // Remove extra spaces in beginning of line if we are not printing a tree.
            line = line.split("@");
            line[0] = line[0].replace(/\s{1,}/g, " ");
            line = line.join("@");
        }

        TERM.stdout.writenl(line);
    }
    Node.prototype.updateDependencyTo = function(name, pointer, options) {
        var self = this;

        var child = self.children[name];

        if (!child) {
            throw new Error("Dependency with name '" + name + "' not found in package '" + self.path + "'!");
        }

        var packageDescriptorPath = PATH.join(self.path, "package.json");

        TERM.stdout.writenl("\0cyan([sm] Updating '" + packageDescriptorPath + "' to set '" + child.status.locator.viaAttribute + " for '" + name + "' to '" + pointer + "'.\0)");

        var descriptor = self.status.descriptor;
        if (/[mM]appings$/.test(child.status.locator.viaAttribute)) {
            // TODO: Resolve `pointer` to location based on `self.status.status.locator` if it is just a version or selector.
            throw new Error("Updating of mappings not yet supported!");
        }
        if (UTIL.isArrayLike(descriptor[child.status.locator.viaAttribute][name])) {
            descriptor[child.status.locator.viaAttribute][name][1] = pointer;
        } else {
            descriptor[child.status.locator.viaAttribute][name] = pointer;
        }

        var deferred = Q.defer();
        FS.writeFile(packageDescriptorPath, JSON.stringify(descriptor, null, 4), function(err) {
            if (err) return deferred.reject(err);
            self.refresh(options).then(function() {
                // NOTE: Don't use `child` here as `self.children` get repopulated during `refresh()`!
                return self.children[name].update(options);
            }).then(deferred.resolve, deferred.reject);
        });
        return deferred.promise;
    }
    Node.prototype.update = function(options) {
    	var self = this;
        if (!self.status.status.newLocator) {
            if (options.debug) console.log("Not updating '" + self.path + "' as `self.status.status.newLocator` is not set!");
            return Q.ref();
        }
        return self.updateTo(self.status.status.newLocator, options);
    }
    Node.prototype.updateTo = function(locator, options) {
        var self = this;
        self.print();
        return self.package.syncWith(locator, options).then(function() {
            var opts = UTIL.copy(options);
            if (options.update) {
                opts.updated = true;
            }
            return self.refresh(opts);
        }).fail(function(err) {
            err.message += " (for package: " + self.path + ")";
            throw err;
        });
    }
    Node.prototype.edit = function(pointer, options) {
        var self = this;
        if (pointer) {
            throw new Error("`pointer` not yet supported!");
        }
        var done = Q.ref();
        if (self.package.inParent) {
            done = Q.when(done, function() {
                var opts = UTIL.copy(options);
                opts.skipParentLookup = true;
                return self.refresh(opts).then(function() {
                    return self.updateTo(self.package.newLocator, options);
                });
            });
        } else
        if (!self.package.locator || !self.package.locator.location) {
            // TODO: Install package if we at all can.
            throw new Error("Cannot edit '" + self.path + "' as `self.locator` is not set! Make sure package is installed. Maybe run: sm install");
//            TERM.stdout.writenl("\0red([sm] ERROR: No source URI found for package.\0)");
//            TERM.stdout.writenl("\0red([sm] WORKAROUND: Specify source URI as third argument to `sm edit`.\0)");
        }
        return Q.when(done, function() {
            var opts = UTIL.copy(options);
            opts.info = true;
            self.print(opts);

            TERM.stdout.writenl("\0cyan([sm]   Switching package '" + self.status.status.path + "' to edit mode.\0)");
            return self.package.edit(pointer, options).then(function() {
                return self.refresh(options).then(function() {
                    self.print();
                });
            });
        });
    }
    Node.prototype.toString = function() {
        var str = this.level + " : " + this.name + " (" + UTIL.len(this.children) + ")";
        if (this.status.descriptor) {
            if (this.status.git) {
                str += " git";
            }
            if (this.status.npm) {
                str += " npm";
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

    return exports.getDependencyTree(pm, options).then(function(fsTree) {
        var rtTree = new Node(fsTree);
        return rtTree.assemble().then(function() {
            return rtTree;
        });
    });
}

exports.getDependencyTree = function(pm, options) {

    options = options || {};

    var Node = function(name, level) {
        var self = this;

        self.name = name || "";
        self.level = level || 0;
        self.parent = null;
        self.dir = false;
        self.loaders = {};
        self.relpath = "";
        self.isSymlinked = false;

        self.addLoader("sourcemint", true, function(options) {
            var deferred = Q.defer();
            var path = PATH.join(self.path, ".sourcemint", "source.json");
            PATH.exists(path, function(exists) {
                if (!exists) {
                    return deferred.resolve(false);
                }
                FS.readFile(path, function(err, data) {
                    if (err) return deferred.reject(err);
                    if (data.length === 0) {
                        console.log("[sm] WARNING: File '" + path + "' is empty although it should not be!");
                        return deferred.resolve(false);
                    }
                    try {
                        var descriptor = JSON.parse(data);
                        // BACKWARDS: `url` is deprecated.
                        if (typeof descriptor.url !== "undefined") {
                            descriptor.locator = {
                                location: descriptor.url
                            };
                            delete descriptor.url;
                        }
                        deferred.resolve(descriptor);
                    } catch(err) {
                        err.message += "(path: " + path + ")";
                        deferred.reject(err);
                    }
                });
            });
            return deferred.promise;
        });

        self.addLoader("git", false, function(options) {
            return SM_PM.forPackagePath(self.path, pm).then(function(pm) {
                return pm.status({
                    name: self.name,
                    private: (self.status.descriptor && self.status.descriptor.private) || false,
                    locator: self.status.locator.viaVersion || self.status.locator.location,
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
            if (!self.name) {
                return false;
            }
            if (self.status.descriptor && self.status.descriptor.private === true) {
                return false;
            }
            if (!(
                (self.status.locator && self.status.locator.pm === "npm") ||
                (self.status.descriptor && self.status.descriptor.pm === "npm")
            )) {
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

        self.addLoader("npm-shrinkwrap", false, function(options) {
            var path = PATH.join(self.path, "npm-shrinkwrap.json");
            if (!PATH.existsSync(path)) return false;
            return JSON.parse(FS.readFileSync(path));
        });

        self.addLoader("sm-catalog", false, function(options) {
            var path = PATH.join(self.path, "sm-catalog.json");
            if (!PATH.existsSync(path)) return false;
            return JSON.parse(FS.readFileSync(path));
        });

        self.addLoader("sm-catalog-locked", false, function(options) {
            var path = PATH.join(self.path, "sm-catalog.locked.json");
            if (!PATH.existsSync(path)) return false;
            return JSON.parse(FS.readFileSync(path));
        });
    }
    Node.prototype = new BaseNode();
    Node.prototype.initForPath = function(path) {
        var self = this;

        if (options.debug) console.log("[sm] Trigger initForPath for node: " + path);

        self.path = path;
        self.exists = false;
        self.children = {};
        self.status = {
            descriptor: false,
            locator: {}
        };

        var deferred = Q.defer();
        PATH.exists(path, function(exists) {
            if (!exists) return deferred.resolve();
            self.exists = true;
            return Q.ninvoke(FS, 'realpath', self.path).then(function(path) {
                self.path = path;
                return DESCRIPTORS.packageForPath(self.path).then(function(descriptor) {
                    self.status.descriptor = descriptor.json;
                    if (self.level === 0 && !self.name) {
                        // Set name of root package.
                        self.name = self.status.descriptor.name;
                    }
                });
            }).then(deferred.resolve, deferred.reject);
        });
        return Q.when(deferred.promise, function() {

            function findDependency(dependencies) {
                if (Array.isArray(dependencies)) {
                    for (var i=0 ; i<dependencies.length ; i++) {
                        if (dependencies[i] === self.name) {
                            // Found but no version specified.
                            return "*";
                        }
                    }
                } else {
                    for (var key in dependencies) {
                        if (key === self.name) {
                            if (dependencies[key] === "" || dependencies[key] === "latest") {
                                return "*";
                            } else {
                                return dependencies[key];
                            }
                        }
                    }
                }
                return false;
            }

            function normalizeMapping(locator) {
                if (typeof locator.viaPm !== "undefined" && locator.viaPm === "sm") {
                    if (UTIL.isArrayLike(locator.pointer)) {
                        locator.pm = locator.pointer[0];
                        locator.descriptorOverlay = locator.pointer[2] || false;
                        locator.pointer = locator.pointer[1];
                    } else {
                        locator.pm = "sm";
                    }
                }
            }

            var locator = {
                // `sm` or `npm` depending on which attribute used.
                viaPm: false,
                // The name of the attribute used.
                viaAttribute: false,
                // The name of the declared package manager to use (or default based on `viaPm`).
                pm: false,
                // The 'selector' (in case of default registry; i.e. npm) or 'location' uri.
                pointer: false,
                // Overrides for the package descriptor.
                descriptorOverlay: false,
                // Flag to indicate whether dependency is or should be bundled.
                bundled: false
            };

            if (self.parent) {
                if (self.parent.status.descriptor.mappings && (locator.pointer = findDependency(self.parent.status.descriptor.mappings))) {
                    locator.viaPm = "sm";
                    locator.viaAttribute = "mappings";
                    normalizeMapping(locator);
                } else
                if (self.parent.status.descriptor.devMappings && (locator.pointer = findDependency(self.parent.status.descriptor.devMappings))) {
                    locator.viaPm = "sm";
                    locator.viaAttribute = "devMappings";
                    normalizeMapping(locator);
                } else
                if (self.parent.status.descriptor.dependencies && (locator.pointer = findDependency(self.parent.status.descriptor.dependencies))) {
                    locator.viaPm = "npm";
                    locator.pm = "npm";
                    locator.viaAttribute = "dependencies";
                } else
                if (self.parent.status.descriptor.devDependencies && (locator.pointer = findDependency(self.parent.status.descriptor.devDependencies))) {
                    locator.viaPm = "npm";
                    locator.pm = "npm";
                    locator.viaAttribute = "devDependencies";
                }
                if (self.parent.status.descriptor.bundleDependencies && findDependency(self.parent.status.descriptor.bundleDependencies)) {
                    locator.viaPm = "npm";
                    locator.pm = "npm";
                    locator.bundled = true;
                }
            } else
            if(self.level === 0 && options.topPointer) {
                locator.pointer = options.topPointer;
                locator.viaPm = "sm";
                locator.viaAttribute = "mappings";
                normalizeMapping(locator);
            }

            self.status.locator = (locator.viaPm)?locator:false;
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
    Node.prototype.refresh = function(options, refreshedPackages) {
        var self = this;
        options = options || {};

        refreshedPackages = refreshedPackages || {};
        if (refreshedPackages[self.path] && refreshedPackages[self.path].isSymlinked !== "inside") {
            self.circular = refreshedPackages[self.path];
            return Q.ref();
        }
        refreshedPackages[self.path] = self;

        self.children = {};

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

                            //if (options.verbose) {
                            //    console.log("Call loader '" + loader[0] + "' for package: " + self.path);
                            //}

                            return Q.when(loader[1][1](options), function(data) {

                                //if (options.verbose) {
                                //    console.log("Done: loader '" + loader[0] + "' for package: " + self.path);
                                //}

                                if (!data) return;

                                if (!self.status[loader[0]]) self.status[loader[0]] = {};

                                // Determine properties that have actually changed.
                                var changes = {};

                                changes[[loader[0]]] = UTIL.deepDiff(data, self.status[loader[0]]);

                                if (UTIL.len(changes[loader[0]]) === 0) return;

                                nodeChanges[loader[0]] = changes[loader[0]];

                                UTIL.deepUpdate(self.status[loader[0]], changes[loader[0]]);
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

            if (typeof options.levels === "number") {
                if (self.level >= options.levels) {
                    return;
                }
            }

            if (!self.exists) {
                return;
            }
            // We can skip some common core packages as they use a shrinkwrap file and should never have outdated dependencies.
            if (pm.context.program.package.descriptor.json.name && !/^sourcemint-|^sm$/.test(pm.context.program.package.descriptor.json.name) && /^sourcemint-/.test(self.name)) {
                return;
            }
            if (self.name === "npm") {
                return;
            }

            if (self.level === 1 && options.all !== true) return;

            if (self.isSymlinked === "inside") return;

            var packages = {};
            function addPackagesForAttribute(attribute) {
                var dependencies = self.status.descriptor[attribute];
                if (!dependencies) return;
                var dir;
                if (Array.isArray(dependencies)) {
                    dir = "mapped_packages";
                    if (/[dD]ependencies/i.test(attribute)) dir = "node_modules";
                    for (var i=0 ; i<dependencies.length ; i++) {
                        packages[dependencies[i]] = [attribute, dir];
                    }
                } else {
                    for (var key in dependencies) {
                        dir = "mapped_packages";
                        if (/[dD]ependencies/i.test(attribute)) dir = "node_modules";
                        if (Array.isArray(dependencies[key]) && dependencies[key][0] === "npm") {
                            dir = "node_modules";
                        }
                        packages[key] = [attribute, dir];
                    }
                }
            }
            addPackagesForAttribute("mappings");
            addPackagesForAttribute("dependencies");
            addPackagesForAttribute("devMappings");
            addPackagesForAttribute("devDependencies");
            //addPackagesForAttribute("bundleDependencies");

            var deferred = Q.defer();

            var waitForDir = WAIT_FOR.makeParallel(function(err) {
                if (err) return deferred.reject(err);

                var queue = Q.ref();
                UTIL.forEach(packages, function(name) {
                    if (!self.children[name[0]]) {
                    	// If dev dependency and not asking for it skip.
                        if (
                            options.dev !== true &&
                            /^dev/.test(packages[name[0]][0])
                        ) return;
	                   	// Only index first level of dependencies.
	                    if (
	                    	options.dev === true &&
                            /^dev/.test(packages[name[0]][0]) &&
	                    	self.level >= 1
	                	) return;
                        queue = Q.when(queue, function() {
                            var node = new Node(name[0], self.level + 1);
                            node.parent = self;
                            node.dir = packages[name[0]][1];
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
				                    	// If dev dependency and not asking for it skip.
                                        if (
                                            options.dev !== true &&
                                            packages[basename] &&
                                            /^dev/.test(packages[basename][0])
                                        ) return done();
                                        var deferred = Q.defer();
                                        var path = PATH.join(basePath, basename);
                                        FS.lstat(path, function(err, stats) {
                                            if (err) return deferred.reject(err);
                                            if (!stats.isDirectory() && !stats.isSymbolicLink()) return deferred.resolve();
                                            delete packages[basename];
                                            var node = new Node(basename, self.level + 1);
                                            node.parent = self;
                                            node.dir = dir;
                                            if (stats.isSymbolicLink()) {
                                        		node.isSymlinked = "outside";
                                            	var linkStr = FS.readlinkSync(path);
                                            	if (!/^\//.test(linkStr)) {
                                            		// Ensure relative path does not go outside of `basePath`.
                                            		if (PATH.join(basePath, linkStr).substring(0, self.path.length) === self.path) {
	                                            		node.isSymlinked = "inside";
                                            		}
                                            	}
                                            }
                                            self.children[basename] = node;
                                            node.initForPath(path).then(function() {
                                                return node.refresh(options, refreshedPackages);
                                            }).then(deferred.resolve, deferred.reject);
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

