
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const UTIL = require("sourcemint-util-js/lib/util");
const Q = require("sourcemint-util-js/lib/q");
const WAIT_FOR = require("sourcemint-util-js/lib/wait-for");
const PACKAGES = require("sourcemint-pinf-js/lib/packages");
const SEMVER_NPM = require("semver");
const EVENTS = require("events");
const SM_PM = require("../pm");


exports.main = function(pm, options) {

    ASSERT(typeof options.pm !== "undefined", "'options.pm' required!");

    return require("sourcemint-pm-" + options.pm + "/lib/pm").status(pm, options);
}


exports.getStatusTree = function(pm, options) {

    var Tree = function(registry) {
        this.registry = registry;
    }
    Tree.prototype = new EVENTS.EventEmitter();
    Tree.prototype.refreshStatus = function(options) {
        var self = this;
        var globalChanges = {};
        var deferred = Q.defer();
        var waitForNodes = WAIT_FOR.makeParallel(function(err) {
            if (err) return deferred.reject(err);
            deferred.resolve();
        });
        // Traverse all nodes.
        self.registry.forEachNode(function(node) {
            waitForNodes(function(done) {
            	if (!node.refreshStatus) {
            		node.refreshStatus = function(options, skipRecursiveTraverse) {
						var deferred = Q.defer();
            			try {
			                var nodeChanges = {};
			                var waitForLoaders = WAIT_FOR.makeParallel(function(err) {
			                    if (err) return deferred.reject(err);
			                    self.emit("updated-node", node, nodeChanges);
			                    deferred.resolve(nodeChanges);
			                });
			                // Traverse all loaders for node.
			                var queue = Q.ref();
			                UTIL.forEach(node.loaders, function(loader) {

			                    waitForLoaders(function(done) {
			                        try {
			                            function callLoader() {

			                                return Q.call(function() {

			                                    return Q.when(loader[1][1](options), function(data) {

			                                        if (!data) return;

			                                        if (!node.status[loader[0]]) node.status[loader[0]] = {};

			                                        // Determine properties that have actually changed.
			                                        var changes = {};

			                                        changes[[loader[0]]] = UTIL.deepDiff(data, node.status[loader[0]]);

			                                        if (UTIL.len(changes[loader[0]]) === 0) return;

			                                        nodeChanges[loader[0]] = changes[loader[0]];

			                                        UTIL.deepUpdate(node.status[loader[0]], changes[loader[0]]);

			                                        self.emit("updated-status", node, changes);

			                                        if (!globalChanges[loader[0]]) globalChanges[loader[0]] = [];
			                                        globalChanges[loader[0]].push([node, changes[loader[0]]]);
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
			            } catch(err) {
			            	deferred.reject(err);
			            }
                        if (skipRecursiveTraverse) {
                            return deferred.promise;
                        }
                        return Q.when(deferred.promise, function(changes) {
                            return node.forEachChildRecursive(function(node) {
                                return node.refreshStatus(options);
                            }).then(function() {
                                return changes;
                            });
                        });
            		};
            	}
            	node.refreshStatus(options, true).then(function() {
            		done();
            	}, done);
            });
        }).then(function() {
            waitForNodes();
        });
        self.on("updated-status", function(node, changes) {
            if (!node.parent && !node.name && changes.descriptor) {
                // Set name of root package.
                node.name = changes.descriptor.name;
            }
            if (changes.descriptor) {
                node.status.summary = node.status.summary || {};

                node.status.summary.version = node.status.descriptor.version || false;
/*
                [
                    "mappings",
                    "devMappings"
                ].forEach(function(name) {
                    if (!node.status.descriptor[name]) return;
                    node.status.summary.mappings = {};
                    UTIL.forEach(node.status.descriptor[name], function(mapping) {
                        if (UTIL.isArrayLike(mapping[1])) {
                            node.status.summary.mappings[mapping[0]] = {
                                pm: mapping[1][0],
                                locator: mapping[1][1],
                                descriptorOverlay: mapping[1][2] || false
                            };
                        } else {
                            node.status.summary.mappings[mapping[0]] = {
                                pm: "sm",
                                locator: mapping[1]
                            };
                        }
                    });
                });
*/
                node.status.summary.libDir = "lib";
                if (node.status.descriptor.directories && typeof node.status.descriptor.directories.lib !== "undefined") {
                    node.status.summary.libDir = node.status.descriptor.directories.lib;
                }
            }
            // HACK: To correct package path if not installed.
            // TODO: This should not be needed once we traverse package directories in this module. i.e. If `pm === "npm"` look in node_modules folder.
            if (changes.locator && changes.locator.pm === "npm" && /mapped_packages\/[^\/]*$/.test(node.path)) {
                node.path = PATH.join(node.path, "../../node_modules", PATH.basename(node.path));
            }
        });
        self.on("updated-node", function(node, changes) {
            node.status.summary = node.status.summary || {};

            if (node.status.locator.viaPm === "npm" && node.status.descriptor) {
                if (
                    typeof node.status.locator.viaVersion !== "undefined" &&
                    node.status.descriptor._from
                ) {
                    var pointer = node.status.descriptor._from.replace(/^[^@]*@/,"");
                    if (SEMVER_NPM.valid(pointer)) {
                        // Convert version to URL.
                        node.status.locator.location = node.status.npm.descriptor.versions[pointer].dist.tarball;
                    } else {
                        node.status.locator.location = pointer;
                    }
                }
            }

            delete node.status.summary.newInSelectorVersion;
            delete node.status.summary.newInSelectorLocation;
            if (node.status.locator.viaPm === "sm") {
                if (node.status.sourcemint) {
                    if (!(
                        node.status.locator.location === node.status.sourcemint.url &&
                        process.version === node.status.sourcemint.nodeVersion
                    )) {
                        // TODO: Set version if we can determine it from `node.status.locator.location`.
                        node.status.summary.newInSelectorVersion = true;
                        node.status.summary.newInSelectorLocation = node.status.locator.location;
                    }
                } else {
                    // TODO: Set version if we can determine it from `node.status.locator.location`.
                    node.status.summary.newInSelectorVersion = true;
                    node.status.summary.newInSelectorLocation = node.status.locator.location;
                }
            } else
            if (node.status.locator.viaPm === "npm") {
                if (node.status.npm && node.status.npm.published) {
                    // New version that is in revision selector stream (new 'minor' version).
                    node.status.summary.newInSelectorVersion = false;
                    // New version that is outside of revision selector stream (new 'major' version).
                    node.status.summary.newOutSelectorVersion = false;
                    if (!node.status.npm.usingLatest) {
                        if (!node.status.npm.usingLatestSatisfying) {
                            node.status.summary.newInSelectorVersion = node.status.npm.latestSatisfyingVersion;
                            if (node.status.npm.descriptor.versions[node.status.summary.newInSelectorVersion]) {
                                node.status.summary.newInSelectorLocation = node.status.npm.descriptor.versions[node.status.summary.newInSelectorVersion].dist.tarball;
                            }
                        } else {
                            node.status.summary.newOutSelectorVersion = node.status.npm.latestVersion;
                        }
                    }
                }
            }

            if (node.status.descriptor) {
                node.status.summary.installed = true;

                var foundLevel = 0;
                function findInParent(parentNode, level) {
                    if (!parentNode) return false;
                    if (node.path.substring(0, parentNode.path.length) === parentNode.path) {
                        // Found at expected dependency path.
                        foundLevel = level;
                        return true;
                    }
                    node.status.summary.isLinked = !findInParent(parentNode.parent, level +1);
                    node.status.summary.isInParent = !node.status.summary.isLinked;
                    return node.status.summary.isInParent;
                }
                findInParent(node.parent, 1);
                if (node.status.summary.isInParent) {
                    node.status.summary.isInParent = foundLevel;
                }
            } else {
                node.status.summary.installed = false;
                delete node.status.summary.isLinked;
                delete node.status.summary.isInParent;
            }
        });
        return Q.when(deferred.promise).then(function() {
            self.emit("updated", null, globalChanges);
            return globalChanges;
        });
    }
    Tree.prototype.forEachNode = function(callback) {
        return this.registry.forEachNode(callback);
    }
    Tree.prototype.toString = function() {
        return this.registry.toString();
    }

    return exports.getDependencyRegistry(pm, options).then(function(registry) {
        return new Tree(registry);
    });
}

exports.getDependencyRegistry = function(pm, options) {

    options = options || {};

    var Node = function(properties) {
        this.name = "";
        this.level = 0;
        this.children = {};
        this.loaders = {};
        this.status = {};
    }
    Node.prototype.init = function(pkgInfo, context) {
        // TODO: Remove this once it is not used above any more.
        this.legacy = [pkgInfo, context];
        this.name = UTIL.unique(pkgInfo[2])[0];
        this.level = context.level;
        this.path = pkgInfo[0].path;
    }
    // TODO: Rename to: forEachNodeRecursive
    Node.prototype.forEachNode = function(callback) {
        var self = this;
        return Q.call(function() {
            return Q.when(callback(self), function(oo) {
                if (oo === false) return;
                return self.forEachChildRecursive(callback);
            });
        });
    }
    Node.prototype.forEachChildRecursive = function(callback) {
        var self = this;
        var done = Q.ref();
        UTIL.forEach(self.children, function(child) {
            done = Q.when(done, function() {
                return child[1].forEachNode(callback);
            });
        });
        return done;
    }
    Node.prototype.forEachChild = function(callback) {
        var self = this;
        var done = Q.ref();
        UTIL.forEach(self.children, function(child) {
            done = Q.when(done, function() {
                return callback(child[1]);
            });
        });
        return done;
    }
    Node.prototype.forEachParent = function(callback, level) {
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
    Node.prototype.addLoader = function(type, waitFor, loader) {
        this.loaders[type] = [waitFor, loader];
    }
    Node.prototype.toString = function() {
        var str = this.level + " : " + this.name + " (" + UTIL.len(this.children) + ")";
        if (this.status.summary.installed) {
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

    var Registry = function() {
        this.tree = new Node();
        this.list = [];
        this.levels = {};
    }
    Registry.prototype.forEachNode = function(callback) {
        return this.tree.forEachNode(callback);
    }
    Registry.prototype.toString = function() {
        return "    " + this.tree.toString();
    }

    var registry = new Registry();

    // Stream in a set of dependency nodes by traversing a tree.
    var lastNode = null;
    function nodeForNextPackage(pkgInfo, context) {
        if (lastNode === null && context.level === 0) {
            // Root package.
            lastNode = registry.tree;
            lastNode.init(pkgInfo, context);
        } else if (lastNode !== null && context.level > 0) {
            var node = new Node();
            node.init(pkgInfo, context);
            if (context.level === lastNode.level) {
                node.parent = lastNode.parent;
            } else
            if (context.level > lastNode.level) {
                node.parent = lastNode;
            } else
            if (context.level < lastNode.level) {
                for( var i=(lastNode.level-context.level) ; i>=0 ; i--) {
                    lastNode = lastNode.parent;
                }
                node.parent = lastNode;
            }
            node.parent.children[node.name] = node;
            lastNode = node;
        }
        return lastNode;
    }

    // TODO: Load dependency tree much faster than what these calls do.
    return PACKAGES.loadDependenciesForProgram(pm.context.program).then(function() {
        return pm.context.program.walkPackages(options, function(parentPkg, pkgInfo, context) {

            if (context.level >= 2 && options.all !== true) {
                return false;
            }

            var node = nodeForNextPackage(pkgInfo, context);

            node.addLoader("descriptor", true, function(options) {
                var path = PATH.join(node.path, "package.json");
                if (!PATH.existsSync(path)) return false;
                return JSON.parse(FS.readFileSync(path));
            });

            node.addLoader("locator", true, function(options) {
                var locator = {};
                if (!node.parent)  return locator;
                function findDependency(dependencies) {
                    if (Array.isArray(dependencies)) {
                        for (var i=0 ; i<dependencies.length ; i++) {
                            if (dependencies[i] === node.name) {
                                // Found but no version specified.
                                return true;
                            }
                        }
                    } else {
                        for (var key in dependencies) {
                            if (key === node.name) {
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
                        locator.descriptorOverlay = locator.viaSelector[2] || false;
                    } else {
                        locator.pm = "sm";
                        locator.location = locator.viaSelector;
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
                    } else {
                        // We have a simple version.
                        locator.location = locator.viaSelector;
                    }
                }
                if (node.parent.status.descriptor.mappings && (locator.viaSelector = findDependency(node.parent.status.descriptor.mappings))) {
                    locator.viaPm = "sm";
                    locator.viaAttribute = "mappings";
                    normalizeMappingLocator(locator);
                } else
                if (node.parent.status.descriptor.devMappings && (locator.viaSelector = findDependency(node.parent.status.descriptor.devMappings))) {
                    locator.viaPm = "sm";
                    locator.viaAttribute = "devMappings";
                    normalizeMappingLocator(locator);
                } else
                if (node.parent.status.descriptor.dependencies && (locator.viaSelector = findDependency(node.parent.status.descriptor.dependencies))) {
                    locator.viaPm = "npm";
                    locator.pm = "npm";
                    locator.viaAttribute = "dependencies";
                    normalizeDependencyLocator(locator);
                } else
                if (node.parent.status.descriptor.devDependencies && (locator.viaSelector = findDependency(node.parent.status.descriptor.devDependencies))) {
                    locator.viaPm = "npm";
                    locator.pm = "npm";
                    locator.viaAttribute = "devDependencies";
                    normalizeDependencyLocator(locator);
                }
                if (node.parent.status.descriptor.bundleDependencies && findDependency(node.parent.status.descriptor.bundleDependencies)) {
                    locator.viaPm = "npm";
                    locator.pm = "npm";
                    locator.bundled = true;
                }
                return locator;
            });

            node.addLoader("sourcemint", true, function(options) {
                var path = PATH.join(node.path, ".sourcemint", "source.json");
                if (!PATH.existsSync(path)) return false;
                return JSON.parse(FS.readFileSync(path));
            });

            node.addLoader("git", false, function(options) {
                return SM_PM.forPackagePath(node.path, pm).then(function(pm) {
                    return pm.status({
                        name: node.name,
                        private: (node.status.descriptor && node.status.descriptor.private) || false,
                        versionSelector: node.status.locator.viaVersion || node.status.locator.location,
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

            node.addLoader("npm", false, function(options) {                
                if ((node.status.descriptor && node.status.descriptor.private === true) || !node.name) {
                    return false;
                }
                return SM_PM.forPackagePath(node.path, pm).then(function(pm) {

                    var fetchedNow = false;

                    function fetch(now) {
                        return pm.status({
                            name: node.name,
                            private: (node.status.descriptor && node.status.descriptor.private) || false,
                            versionSelector: node.status.locator.viaVersion || node.status.locator.location,
                            now: (fetchedNow = (now || options.now)),
                            time: options.time,
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

            // We can skip some common core packages as they use a shrinkwrap file and should never be outdated.
            if (!/^sourcemint-|^sm$/.test(pm.context.program.package.descriptor.json.name) && /^sourcemint-/.test(node.name)) {
                return false;
            }
            if (node.name === "npm") {
                return false;
            }
        });
    }).then(function() {
        return registry;
    });
}

