
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("graceful-fs");
const UTIL = require("sourcemint-util-js/lib/util");
const Q = require("sourcemint-util-js/lib/q");
const WAIT_FOR = require("sourcemint-util-js/lib/wait-for");
const PACKAGES = require("sourcemint-pinf-js/lib/packages");
const DESCRIPTORS = require("sourcemint-pinf-js/lib/descriptors");
const URI_PARSER = require("sourcemint-pm-sm/lib/uri-parser");
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

    // TODO: Put this into the registry.
    var ee = new EVENTS.EventEmitter();
    ee.setMaxListeners(10000);

    var Node = function(name, level) {
        var self = this;

        self.name = name || "";
        self.path = null;
        self.exists = false;
        self.level = level || 0;
        self.children = {};
        self.loaders = {};
        self.status = {};

        self.on("updated-status", function(changes) {
            if (!self.parent && !self.name && changes.descriptor) {
                // Set name of root package.
                self.name = changes.descriptor.name;
            }
            if (changes.descriptor) {
                self.status.summary = self.status.summary || {};

                self.status.summary.version = self.status.descriptor.version || false;

                self.status.summary.libDir = "lib";
                if (self.status.descriptor.directories && typeof self.status.descriptor.directories.lib !== "undefined") {
                    self.status.summary.libDir = self.status.descriptor.directories.lib;
                }
            }
            // HACK: To correct package path if not installed.
            // TODO: This should not be needed once we traverse package directories in this module. i.e. If `pm === "npm"` look in node_modules folder.
//            if (changes.locator && changes.locator.pm === "npm" && /mapped_packages\/[^\/]*$/.test(self.path)) {
//                self.path = PATH.join(self.path, "../../node_modules", PATH.basename(self.path));
//            }
        });


        function inheritFromNode(node) {            
            self.exists = node.exists;
            var changes = UTIL.deepDiff(node.status, self.status);
            delete changes.summary;
            UTIL.deepUpdate(self.status, changes);
            self.emit("updated-status", changes);
            self.children = UTIL.copy(node.children);
            return changes;
        }

        // TODO: Improve package in parent detection by having two trees: One for
        //       what is actually on disk and one for what is resolved logically.
        var updatedChildNodes = function(node) {
            if (!self.exists && !self.circular && node.children && node.children[self.name] && node.children[self.name].exists && !node.children[self.name].circular) {
                self.exists = true;
                self.path = node.children[self.name].path;
                self.refresh();
            }
        };


        function updatedNode(changes) {

            self.status.summary = self.status.summary || {};

            if (self.circular) {
                changes = inheritFromNode(self.circular);
            }

            if (self.status.locator.viaPm === "npm" && self.status.descriptor) {
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

            if (self.status.locator.viaPm === "sm") {
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
            if (self.status.locator.viaPm === "npm") {
                if (self.status.npm && self.status.npm.published) {
                    // New version that is in revision selector stream (new 'minor' version).
                    self.status.summary.newInSelectorVersion = false;
                    // New version that is outside of revision selector stream (new 'major' version).
                    self.status.summary.newOutSelectorVersion = false;
                    if (!self.status.npm.usingLatest) {
                        if (!self.status.npm.usingLatestSatisfying) {
                            self.status.summary.newInSelectorVersion = self.status.npm.latestSatisfyingVersion;
                            if (self.status.npm.descriptor.versions[self.status.summary.newInSelectorVersion]) {
                                self.status.summary.newInSelectorLocation = self.status.npm.descriptor.versions[self.status.summary.newInSelectorVersion].dist.tarball;
                            }
                        } else {
                            self.status.summary.newOutSelectorVersion = self.status.npm.latestVersion;
                        }
                    }
                }
            }

            if (self.status.summary.newInSelectorVersion) {
                if (self.status.git && self.status.git.rev === self.status.summary.newInSelectorVersion) {
                    self.status.summary.newInSelectorVersion = false;
                }
            }

            function findInParent(parentNode, level) {
                if (!parentNode) return false;
                if (parentNode.children[self.name] && parentNode.children[self.name].path === self.path) {
                    self.status.summary.inParent = level;
                    return true;
                }
                findInParent(parentNode.parent, level + 1);
            }
            if (self.parent) findInParent(self.parent.parent, 1);

            if (self.status.descriptor) {
                self.status.summary.installed = true;

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
            } else {
                self.status.summary.installed = false;
                delete self.status.summary.isLinked;
                delete self.status.summary.isWithinParents;
            }

            if (ee.listeners("updated-child-nodes").indexOf(updatedChildNodes) === -1) {
                ee.on("updated-child-nodes", updatedChildNodes);
            }

            ee.emit("updated-node", self);
        }

        self.on("updated-node", updatedNode);

        self.on("updated-child-nodes", function() {
            ee.emit("updated-child-nodes", self);
        });


        self.addLoader("descriptor", true, function(options) {
            var path = PATH.join(self.path, "package.json");
            if (!PATH.existsSync(path)) return false;
            return JSON.parse(FS.readFileSync(path));
        });

        self.addLoader("locator", true, function(options) {
            var locator = {};
            if (!self.parent) return locator;
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
            return locator;
        });

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

                function fetch(now) {
                    if (options.now) now = options.now;
                    if (now) fetchedNow = now;
                    return pm.status({
                        name: self.name,
                        private: (self.status.descriptor && self.status.descriptor.private) || false,
                        versionSelector: self.status.locator.viaVersion || self.status.locator.location,
                        now: now,
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
    }
    Node.prototype = new EVENTS.EventEmitter();
    Node.prototype.initForPath = function(path) {
        var self = this;
        var deferred = Q.defer();
        self.path = path;
        PATH.exists(path, function(exists) {
            Q.call(function() {
                if (!exists) {
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
                }
            }).then(function() {
                var deferred = Q.defer();
                PATH.exists(self.path, function(exists) {
                    if (!exists) return deferred.resolve();
                    self.exists = true;
                    return Q.ninvoke(FS, 'realpath', self.path).then(function(path) {
                        self.path = path;
                        return DESCRIPTORS.packageForPath(self.path).then(function(descriptor) {
                            self.descriptor = descriptor;
                        });
                    }).then(deferred.resolve, deferred.reject);
                });
                return deferred.promise;
            }).then(deferred.resolve, deferred.reject);
        });
        return deferred.promise;
    }
    Node.prototype.initForLegacy = function(pkgInfo, context) {
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
                if (self.circular) return;
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


// TODO: Run this after `updated-node` fired on self & on parent to get `inherits` if inherits gets
// initialize after our node.
/*
        if ()
            self.exists = self.circular.exists;
            self.status = UTIL.deepCopy(self.circular.status);
            self.emit("updated-status", self.status);
            delete self.status.summary;
            self.children = UTIL.copy(self.circular.children);
            self.emit("updated-node", self.status);
*/

        refreshedPackages = refreshedPackages || {};
        if (refreshedPackages[self.path]) {
            self.circular = refreshedPackages[self.path];
            self.emit("updated-node", {});
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

                                self.emit("updated-status", changes);
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
                var dependencies = self.descriptor.json[attribute];
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

            var waitFor = WAIT_FOR.makeSerial(function(err) {
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
                waitFor(PATH.join(self.path, dir), function(basePath, done) {
                    PATH.exists(basePath, function(exists) {
                        if (!exists) return done();
                        FS.readdir(basePath, function(err, basenames) {
                            if (err) return done(err);
                            var queue = Q.ref();
                            basenames.forEach(function(basename) {
                                if (/~backup-/.test(basename)) return;
                                if (/^\./.test(basename)) return;
                                queue = Q.when(queue, function() {
                                    if (!self.children[basename]) {
                                        if (
                                            options.dev !== true &&
                                            packages[basename] &&
                                            /^dev/.test(packages[basename][0])
                                        ) return;
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
                                                FS.stat(path, function(err, stats) {
                                                    if (err) return deferred.reject(err);
                                                    if (!stats.isDirectory()) return deferred.resolve();
                                                    delete packages[basename];
                                                    var node = new Node(basename, self.level + 1);
                                                    node.parent = self;
                                                    self.children[basename] = node;
                                                    node.initForPath(path).then(function() {
                                                        return node.refresh(options, refreshedPackages);
                                                    }).then(deferred.resolve, deferred.reject);
                                                });
                                            }
                                        });
                                        return deferred.promise;
                                    }
                                });
                            });
                            Q.when(queue, done, done);
                        });
                    });
                });
            });
            waitFor();

            return Q.when(deferred.promise, function() {
                self.emit("updated-child-nodes");
            });
        });
    }

    var Registry = function() {
        this.tree = null;
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

    registry.tree = new Node(pm.context.program.package.name);

    return registry.tree.initForPath(pm.context.program.package.path).then(function() {
        return registry.tree.refresh(options);
    }).then(function() {
        return registry;
    });
}

