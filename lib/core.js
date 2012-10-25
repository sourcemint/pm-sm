
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
const SM_PM = require("./pm");



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
                if (SEMVER_NPM.valid(pointer) && self.status.npm && self.status.npm.descriptor.versions[pointer]) {
                    // Convert version to URL.
                    self.status.locator.location = self.status.npm.descriptor.versions[pointer].dist.tarball;
                }
            }
        }

        // TODO: Rename 'newInSelectorVersion' to 'newInSelector'.
        // TODO: Rename 'newInSelectorLocation' to 'newInLocator'.
        delete self.status.summary.newInSelectorVersion;
        delete self.status.summary.newInSelectorLocation;
        delete self.status.summary.newInSelectorNodeVersion;

        if (self.status.locator && self.status.locator.viaPm === "sm") {
            var locationInfo = false;
            if (self.status.sourcemint) {
                locationInfo = URI_PARSER.parse(self.status.locator.location);
                // We need to match the potential git URI or TAR uri.
                // TODO: Improve this hacky mess when we cleanup up how locators are handled.
                var url = [ self.status.locator.location ];
                if (locationInfo && locationInfo.locators) {
                    url = [ locationInfo.locators["git-write"] + "#" + self.status.locator.version ];
                    url.push(URI_PARSER.parse(url[0]).locators.tar);
                }
                if (!(
                    url.indexOf(self.status.sourcemint.locator) >= 0 &&
                    process.version === self.status.sourcemint.nodeVersion
                )) {
                    self.status.summary.newInSelectorVersion = self.status.locator.version;  //(locationInfo && locationInfo.vendor && locationInfo.vendor.rev) || true;
                    self.status.summary.newInSelectorLocation = self.status.locator.location;
                    if (process.version !== self.status.sourcemint.nodeVersion) {
                        self.status.summary.newInSelectorNodeVersion = process.version;
                    }
                }
            } else {
                locationInfo = URI_PARSER.parse(self.status.locator.location);
                self.status.summary.newInSelectorVersion = self.status.locator.version;  //(locationInfo && locationInfo.vendor && locationInfo.vendor.rev) || true;
                self.status.summary.newInSelectorLocation = self.status.locator.location;
            }
            if (self.status.summary.newInSelectorVersion && self.status.summary.newInSelectorLocation && locationInfo && locationInfo.locators) {
                // Convert potential selector-based location to exact location.
                self.status.summary.newInSelectorLocation = locationInfo.locators["git-write"] + "#" + self.status.summary.newInSelectorVersion;
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
                            if (self.status.summary.newInSelectorVersion === false) {
                                // Assuming `self.status.npm.versionSelector` is a URL.
                                self.status.summary.newInSelectorLocation = self.status.npm.versionSelector;
                            } else {
                                self.status.summary.newInSelectorLocation = false;
                            }
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
        } else {
            self.status.summary.installed = false;
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
    Node.prototype.assemble = function(context, inheritedStatus) {
        var self = this;

        context = UTIL.copy(context);
        var lastPackageByName = {};
        UTIL.forEach(context.lastPackageByName || {}, function(node) {
	        lastPackageByName[node[0]] = UTIL.copy(context.lastPackageByName[node[0]]);
        });
        context.lastPackageByName = lastPackageByName;
        self.context = context;

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
					self.status.summary.inParent = self.level - context.lastPackageByName[self.name][i].level;
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
            newInLocator: (self.status.summary && self.status.summary.newInSelectorLocation) || false,
            newOutVersion: (self.status.summary && self.status.summary.newOutSelectorVersion) || false,
            // TODO: Only store in 'selector' if version/revision, otherwise store URI in 'locator'.
            selector: (self.status.locator &&
                       (self.status.locator.selector || 
                        self.status.locator.version || 
                        self.status.locator.viaVersion || 
                        self.status.locator.location || 
                        self.status.locator.viaSelector)) || 
                      (self.status.npm && self.status.npm.actualVersion),
            locator: (self.status.sourcemint && self.status.sourcemint.locator) || false,
            vcs: false,
            path: self.path
        };
        if (info.symlinked === "outside" || (inheritedStatus && inheritedStatus.symlinked === "outside")) {
            info.relpath = self.path;
        } else {
            info.relpath = self.path.substring(pm.context.program.package.path.length + 1);
        }
        if (self.status.sourcemint && self.status.sourcemint.nodeVersion) {
            info.nodeVersion = self.status.sourcemint.nodeVersion;
        }

        if ((self.status.locator && self.status.locator.pm === "npm") || (self.status.npm && self.status.npm.published)) {
            info.npm = true;
        }
        if (self.status.git) {
            info.git = self.status.git;
        }
        if (self.status.vcs) {
            info.vcs = self.status.vcs;
        }


        function repositoryFromDescriptor(descriptor) {
            var repositories = descriptor.repository;
            if (!repositories) {
                repositories = descriptor.repositories;
            } else {
                repositories = [ repositories ];
            }
            var url = false;
            if (repositories) {
                var repository = repositories[0];
                var url = false;
                if (typeof repository === "string") {
                    url = repository;
                } else if(repository.url) {
                    url = repository.url;
                }
            }
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
        self.status.status = info;


        // Update deep status summary.
        var deepStatus = {
            errors: false,
            newInVersion: false,
            newOutVersion: false,
            dirty: false,
            behind: false,
            ahead: false,
            missing: false,
            vcs: false
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
        if (info.vcs) {
            deepStatus.vcs = true;
        }
        if (info.git && (info.git.dirty || info.git.behind || info.git.ahead)) {
            deepStatus.errors = true;
            deepStatus.dirty = info.git.dirty;
            deepStatus.behind = info.git.behind;
            deepStatus.ahead = info.git.ahead;
        }
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
	        return self.parent.bubbleDeepStatusUpdate();
        }


        // Update inherited status summary.
        if (inheritedStatus) {
        	self.status.inheritedStatus = inheritedStatus;
	        inheritedStatus = UTIL.copy(inheritedStatus);
        } else {
        	inheritedStatus = {
        		vcs: false
        	};
        }
        if (self.level > 0) {
	        if (self.status.status.vcs) {
	        	inheritedStatus.vcs = self.status.status.vcs;
	        }
	        if (self.status.status.symlinked) {
	        	inheritedStatus.symlinked = self.status.status.symlinked;
	        }
	    }


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

        var waitFor = WAIT_FOR.makeSerial(function(err) {
            if (err) return deferred.reject(err);            
            self.status.deepStatus = deepStatus;
            deferred.resolve();
        });
        UTIL.forEach(self.children, function(child) {
            waitFor(function(done) {
                Q.when(child[1].assemble(context, inheritedStatus), done, done).then(function() {
                    updateDeepStatusForChild(deepStatus, child[1]);
                });
            });
        });
        waitFor();

        if (!self.refresh) {
        	self.refresh = function(options) {
        		var fsNode = self.fsNode;
        		return fsNode.initForPath(fsNode.path).then(function() {
	        		return fsNode.refresh(options).then(function() {
	        			self.fsNode = null;
	        			self.initFromFsNode(fsNode);
		        		return self.assemble(self.context, self.status.inheritedStatus).then(function() {
							// Now that this node and its children have been updated we need to update
							// the deep status in the parents.
							self.parent.bubbleDeepStatusUpdate();
						});
	        		});
        		});
        	}
        }

        return deferred.promise;
    }
    Node.prototype.update = function() {
    	var self = this;

    	if (self.level === 0) {
    		throw new Error("Cannot call `update` on root package!");
    	}

    	if (!self.status.status.installed) {
            TERM.stdout.writenl("\0cyan([sm] Installing missing '" + self.status.status.relpath + "' from '" + self.status.summary.newInSelectorLocation + "'\0)");
    	} else
        if (self.status.status.newInVersion) {
            TERM.stdout.writenl("\0cyan([sm] Updating outdated '" + self.status.status.relpath + "' to '" + self.status.summary.newInSelectorLocation + "'\0)");
        }

        return SM_PM.forPackagePath(self.path, pm).then(function(pm) {

            var opts = UTIL.copy(options);
            opts.pm = self.status.locator.pm;
            opts.locator = self.status.summary.newInSelectorLocation || self.status.locator.location;
            opts.descriptorOverlay = self.status.locator.descriptorOverlay;
            opts.name = self.name;
            opts.force = true;

            // TODO: Pass along locator object instead of string so pm can use URI it desires. We can then remove this.
            if (opts.pm === "tar") {
                var parsedUri = URI_PARSER.parse(opts.locator);
                if (parsedUri && parsedUri.locators) {
                    opts.locator = parsedUri.locators.tar;
                }
            }

            return Q.when(pm.install(opts), function() {

                if (!PATH.existsSync(PATH.join(self.path, ".sourcemint"))) {
                    FS.mkdirSync(PATH.join(self.path, ".sourcemint"));
                }
                FS.writeFile(PATH.join(self.path, ".sourcemint", "source.json"), JSON.stringify({
                    locator: opts.locator,
                    nodeVersion: process.version,
                    time: pm.context.time
                }));
            }).then(function() {
				return self.refresh(options);
            }).fail(function(err) {
                if (self.parent) {
                    err.message += " (for package: " + self.path + ")";
                }
                throw err;
            });
        });
    }
    Node.prototype.edit = function() {
        var self = this;

        TERM.stdout.writenl("\0cyan([sm] Switching package '" + self.status.status.relpath + "' to edit mode.\0)");

        return SM_PM.forPackagePath(self.path, pm).then(function(pm) {
            var opts = UTIL.copy(options);
            opts.pm = "git";
            opts.node = self;
            return Q.when(pm.edit(opts), function() {
                return self.refresh(options);
            });
        });
    }
    Node.prototype.toString = function() {
    	// TODO: Use `this.status.status` instead of `this.status.summary`.
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

    return exports.getDependencyTree(pm, options).then(function(fsTree) {
        var rtTree = new Node(fsTree);
        var lastPackageByName = {};
        lastPackageByName[fsTree.status.descriptor.name] = [
            rtTree
        ];
        return rtTree.assemble({
            lastPackageByName: lastPackageByName
        }).then(function() {
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
        self.parent = null;
        self.children = {};
        self.loaders = {};
        self.status = {
            descriptor: false,
            locator: {}
        };

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
                    locator: self.status.locator.viaVersion || self.status.locator.location,
                    now: options.now,
                    verbose: options.verbose,
                    pm: "git"
                });
            }).then(function(gitInfo) {
                if (gitInfo.type !== "git") return false;
                delete gitInfo.type;
                return gitInfo;
            }).then(function(gitInfo) {

                if (self.status.locator && self.status.locator.selector && gitInfo.tags && self.status.locator.viaPm === "sm") {
                    try {
                        var tag = SEMVER.latestForMajor(SEMVER.versionsForTags(gitInfo.tags), self.status.locator.selector);
                        if (tag) {
                            self.status.locator.version = tag;
                        }
                    } catch(err) {}
                }

                if (gitInfo.fromCache) {
                    gitInfo = false;
                }

                return gitInfo;
            });
        });

        self.addLoader("npm", false, function(options) {                
            if (!self.name || self.status.locator.pm !== "npm") {
                return false;
            }
            if (self.status.descriptor && self.status.descriptor.private === true) {
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
        self.exists = false;
        self.path = path;
        var deferred = Q.defer();
        PATH.exists(path, function(exists) {
            if (!exists) return deferred.resolve();
            self.exists = true;
            return Q.ninvoke(FS, 'realpath', self.path).then(function(path) {
                self.path = path;
                return DESCRIPTORS.packageForPath(self.path).then(function(descriptor) {
                    self.status.descriptor = descriptor.json;
                });
            }).then(deferred.resolve, deferred.reject);
        });
        return Q.when(deferred.promise, function() {

            if (!self.parent) return;

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

            var locator = {
                selector: false
            };

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

            // TODO: Rename `viaSelector` to `viaLocator` as 'selector' should only refer to version and not include URI.
            if (locator.version && locator.version.split(".").length <= 2) {
                locator.selector = locator.version;
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

            if (self.isSymlinked === "inside") return;

            var packages = {};
            function addPackagesForAttribute(attribute) {
                var dependencies = self.status.descriptor[attribute];
                if (!dependencies) return;
                var dir;
                if (Array.isArray(dependencies)) {
                    dir = "mapped_packages";
                    if (/dependencies/i.test(attribute)) dir = "node_modules";
                    for (var i=0 ; i<dependencies.length ; i++) {
                        packages[dependencies[i]] = [attribute, dir];
                    }
                } else {
                    for (var key in dependencies) {
                        dir = "mapped_packages";
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

