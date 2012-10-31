
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const URL = require("url");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const Q = require("sourcemint-util-js/lib/q");
const FS_RECURSIVE = require("sourcemint-util-js/lib/fs-recursive");
const URI_PARSER = require("./uri-parser");
const LOCATOR = require("./locator");
const URL_PROXY_CACHE = require("sourcemint-util-js/lib/url-proxy-cache");


function inheritOptions(options, extra) {
    var opts = {
    	verbose: options.verbose || false,
    	debug: options.debug || false,
    	time: options.time || false,
    	now: options.now || false,
    	"dry-run": options["dry-run"] || false,
    	vcsOnly: options.vcsOnly || false,
    	keepTopVcs: options.keepTopVcs || false
    };
    if (extra) {
    	UTIL.update(opts, extra);
    }
    return opts;
}

function uriToPath(uri) {
	return uri.replace(/[:@#]/g, "/").replace(/[\?&=]/g, "+").replace(/\/+/g, "/");
}

exports.forNode = function(pm, node) {
    var package = new Package(pm);
	UTIL.forEach(node.status.status, function(pair) {
		package[pair[0]] = pair[1];
	});
	ASSERT(typeof package.path !== "undefined", "`package.pm` is required!");
	var packageManagers = {};
	var urlProxyCache = false;
    package.helpers = {
		pmForType: function(type) {
			if (packageManagers[type]) {
				// TODO: Is there some sugar for this?
				var deferred = Q.defer();
				deferred.resolve(packageManagers[type]);
				return deferred.promise;
			}
			return Q.call(function() {
				var uri = "sourcemint-pm-" + type + "/lib/pm";
				// TODO: Use dynamic `SM.require`.
				var module = require(uri);
				if (typeof module.for !== "function") {
					throw new Error("Package manager at '" + uri + "' does not implement `exports.for`. Needed by package '" + package.path + "'.");
				}
//		        return module.for(package);
// TODO: Deprecate `package` argument.
		        return module.for(null);
			}).then(function(instance) {
				packageManagers[type] = instance;
				return instance;
			});
		},
		locatorFactory: function() {
			return LOCATOR.for(pm, node.status);
		},
		// TODO: Put this into `LOCATOR`?
    	cachePath: function(type, uri) {
    		var path = false;
    		if (type === "install") {
    			path = PATH.join(
					pm.context.homeBasePath,
					"cache/install",
					package.platformName + "-" + (package.newPlatformVersion || package.platformVersion),
					uriToPath(uri)
				);
    		} else
    		if (type === "external") {
    			path = PATH.join(
					pm.context.homeBasePath,
					"cache/external"
				);
				if (uri) {
					path = PATH.join(path, uriToPath(uri));
				}
    		}
    		if (!path) {
	    		throw new Error("Unknown cache type '" + type + "'");
    		}
			if (!PATH.existsSync(PATH.dirname(path))) {
	            FS_RECURSIVE.mkdirSyncRecursive(PATH.dirname(path));
			}
			return path;
    	},
		// TODO: Put this into `LOCATOR`?
    	fetchExternalUri: function(uri, options) {
    		if (!urlProxyCache) {
	            urlProxyCache = new URL_PROXY_CACHE.UrlProxyCache(package.helpers.cachePath("external"), {
	                verbose: options.verbose,
	                debug: options.debug,
	                ttl: 0    // Indefinite
	            });
	            urlProxyCache.parseUrl = function(url) {
				    var urlInfo = URL.parse(url);
				    urlInfo.cachePath = PATH.join(urlProxyCache.path, uriToPath(url));
				    return urlInfo;
				}
    		}
    		if (typeof options.ttl === "undefined") {
		        options.ttl = ((options.now)?options.time*-1:(7 * 24 * 60 * 60 * 1000))    // 7 Days
    		}
    		if (typeof options.loadBody === "undefined") {
		        options.loadBody = false;
    		}
            if (options.verbose) TERM.stdout.writenl("\0cyan([sm]   Fetching: " + uri + "\0)");
            return urlProxyCache.get(uri, options);
    	}
    };
    return package;
}


var Package = function() {};

Package.prototype.syncWith = function(locator, options) {
	var self = this;

    TERM.stdout.writenl("\0cyan([sm]   Syncing '" + self.path + "' with '" + locator.toString("uri") + "'\0)");

    // TODO: Move 'dry-run' deeper.
    if (options["dry-run"]) {
        return Q.ref();
    }

	var location = locator.toUniqueIdentityObject().location;

//console.log("[syncWith]", locator, options);

	var done = Q.ref();

	var proceed = true;

	if (PATH.existsSync(self.path)) {
		done = Q.when(done, function() {
			return self.helpers.pmForType("git").then(function(pm) {
				return pm.status(self.path, inheritOptions(options)).then(function(status) {
					if (!status) return;
					// TODO: Also check if there are other remotes than 'origin' and anything else that has changed.
					//		 Only allow to proceed if state can be completely re-created from cache.
	                if (status.dirty || status.ahead) {
	                	proceed = false;
	                	TERM.stdout.writenl("\0red([sm] ERROR: Cannot update '" + self.path + "' as git repository is dirty or ahead.\0)");
	                	return;
	                }
		        });
			});
		});
	}

	return Q.when(done, function() {

		if (!proceed) return;

		var installCachePath = self.helpers.cachePath("install", location);
		if (options.vcsOnly) {
			installCachePath = self.path;
		}
		var parsedLocation = URI_PARSER.parse(location);
		if (!parsedLocation || !parsedLocation.uris) {
			throw new Error("Could not determine alternative uris for location '" + location + "'!");
		}

		// Download package at `location` which includes a version or exact ref.

		function downloadVia(via, uri, force) {
    		var path = self.helpers.cachePath("external", uri);
    		// If `via` is a VCS, only download (fetch latest) if already found unless `force` is set.
    		if (via === "git") {
	    		if (!PATH.existsSync(path) && !force) return Q.ref();
    		}
			return self.helpers.pmForType(via).then(function(pm) {
				return Q.when(self.helpers.locatorFactory().fromObject({
					pointer: uri
				}), function(fromLocator) {
					// TODO: Implement `fetch` in `LOCATOR` and not here.
					fromLocator.fetch = function(options) {
			            return self.helpers.fetchExternalUri(fromLocator.location, options);
					}
					return Q.when(self.helpers.locatorFactory().fromObject({
						pointer: path
					}), function(toLocator) {
						var opts = UTIL.copy(options);
						opts.vcsOnly = false;
						return pm.download(fromLocator, toLocator, inheritOptions(opts));
					});
				});
			}).then(function(response) {
				if (!response) {
					throw new Error("Empty download response!");
				}
				ASSERT(typeof response.status === "number", "`response.status` must be an integer!");
				if (response.cachePath) {
					path = response.cachePath;
					delete response.cachePath;
				}
				response.path = path;
				return response;
			}, function(err) {
	            if (PATH.existsSync(path)) {
	                FS_RECURSIVE.rmSyncRecursive(path);
	            }
	            throw err;
	    	});
		}

		var externalCachePath = false;
		var externalCacheStatus = false;
		var extractor = false;

		var done = Q.ref();

		// First try and download via VCS (if a repository is already cached locally or `options.keepTopVcs` is set).
		done = Q.when(done, function() {
	    	if (parsedLocation.uris["git-write"]) {
				return downloadVia("git", parsedLocation.uris["git-write"], (self.level === 0 && options.keepTopVcs) || options.vcsOnly || false).then(function(response) {
					if (response) {
						extractor = "git";
						externalCacheStatus = response.status;
						externalCachePath = response.path;
					}
				});
			}
		});
		// If not downloaded try and download cia non-VCS.
		done = Q.when(done, function() {
			if (!externalCachePath && parsedLocation.uris["tar"]) {
				return downloadVia("tar", parsedLocation.uris["tar"], false).then(function(response) {
					if (response.status !== 200 && response.status !== 304) {
			            if (options.verbose) TERM.stdout.writenl("\0yellow([sm]   Error downloading '" + parsedLocation.uris["tar"] + "'. Trying via VCS.\0)");
			            return;
					}
					extractor = "tar";
					externalCacheStatus = response.status;
					externalCachePath = response.path;					
				});
			}
		});
		// If still not downloaded try via VCS and force creation of local cache if not exists.
		done = Q.when(done, function() {
			if (!externalCachePath && parsedLocation.uris["git-write"]) {
				return downloadVia("git", parsedLocation.uris["git-write"], true).then(function(response) {
					extractor = "git";
					externalCacheStatus = response.status;
					externalCachePath = response.path;
				});
			}
		});

    	return Q.when(done, function() {
			if (!externalCachePath) {
				throw new Error("Could not determine download uri for location '" + location + "'!");
			}
			if (externalCacheStatus !== 200 && externalCacheStatus !== 304) {
				throw new Error("Error downloading '" + location + "'. Got status: " + externalCacheStatus);
			}
			if (PATH.existsSync(installCachePath) && !options.vcsOnly) {
				if (externalCacheStatus === 304) {
		            if (options.verbose) TERM.stdout.writenl("\0cyan([sm]   Cached install: " + installCachePath + "\0)");
				} else {
		            var backupPath = installCachePath + "~backup-" + Date.now();
		            if (options.verbose) TERM.stdout.writenl("\0cyan([sm]   Backing up '" + installCachePath + "' to '" + backupPath + "'." + "\0)");
		            FS.renameSync(installCachePath, backupPath);
		        }
			} else
			if (!PATH.existsSync(PATH.dirname(installCachePath))) {
	            FS_RECURSIVE.mkdirSyncRecursive(PATH.dirname(installCachePath));
			}
			return self.helpers.pmForType(extractor).then(function(pm) {
	            if (options.verbose) TERM.stdout.writenl("\0cyan([sm]   Extracting '" + externalCachePath + "' to '" + installCachePath + "'\0)");
				return Q.when(self.helpers.locatorFactory().fromObject({
					pointer: externalCachePath
				}), function(fromLocator) {
					return Q.when(self.helpers.locatorFactory().fromObject({
						pointer: installCachePath
					}), function(toLocator) {
						if (options.vcsOnly) {
							toLocator.version = locator.version;
						}
						return pm.extract(fromLocator, toLocator, inheritOptions(options));
					});
				});
			}).then(function() {
				if ((self.level === 0 && options.keepTopVcs) || options.vcsOnly) return;
				// Sanitize.
				// TODO: Also remove `.svn` and other VCS dirs.
	            if (PATH.existsSync(PATH.join(installCachePath, ".git"))) {
	                FS_RECURSIVE.rmdirSyncRecursive(PATH.join(installCachePath, ".git"));
	            }
			}).then(function() {
				if (options.vcsOnly) return;
	    		return self.helpers.pmForType(self.pm).then(function(pm) {
		            if (options.verbose) TERM.stdout.writenl("\0cyan([sm]   Installing '" + installCachePath + "' via '" + self.pm + "'.\0)");
					return Q.when(self.helpers.locatorFactory().fromObject({
						pointer: installCachePath
					}), function(toLocator) {
						if (typeof pm.install === "function") {
							return pm.install(toLocator, inheritOptions(options));
						}
					});
	    		});
			}, function(err) {
	    		if (installCachePath && PATH.existsSync(installCachePath)) {
	                // TODO: Instead of deleting failed install here we should copy it to archive so it can be inspected.
	                FS_RECURSIVE.rmdirSyncRecursive(installCachePath);
	    		}
	    		throw err;
	    	});
    	}).then(function() {
			if (options.vcsOnly) return;
	        if (PATH.existsSync(self.path)) {
	            var backupPath = self.path + "~backup-" + Date.now();
	            if (options.verbose) TERM.stdout.writenl("\0cyan([sm]   Backing up '" + self.path + "' to '" + backupPath + "'." + "\0)");
	            FS.renameSync(self.path, backupPath);
	        }
	        FS_RECURSIVE.mkdirSyncRecursive(self.path);
	        if (options.verbose) TERM.stdout.writenl("\0cyan([sm]   Copying cached install from '" + installCachePath + "' to '" + self.path + "'.\0)");
	        return FS_RECURSIVE.osCopyDirRecursive(installCachePath, self.path).then(function() {
        		self.locator = locator;
	        	if (self.level > 0) {
		        	return self.postinstall(options);
		        }
	        }, function(err) {
	            if (PATH.existsSync(self.path)) {
	                FS_RECURSIVE.rmdirSyncRecursive(self.path);
	            }
	            throw err;
	        });
		});
	});
}

Package.prototype.postinstall = function(options) {
	var self = this;
	var type = self.pm;
    // Always treat top-level package as 'sm' package.
	if (self.level === 0) {
		type = "sm";
	}
    return self.helpers.pmForType(type).then(function(pm) {
    	function writeSourceFile() {
        	var deferred = Q.defer();
        	function writeFile() {
                FS.writeFile(PATH.join(self.path, ".sourcemint", "source.json"), JSON.stringify({
                    locator: self.locator.toUniqueIdentityObject(),
                    platformVersion: self.newPlatformVersion || self.platformVersion,
                    time: options.time
                }), function(err) {
    				if (err) return deferred.reject(err);
    				deferred.resolve();
                });
        	}
        	PATH.exists(PATH.join(self.path, ".sourcemint"), function(exists) {
        		if (!exists) {
        			FS.mkdir(PATH.join(self.path, ".sourcemint"), function(err) {
        				if (err) return deferred.reject(err);
        				writeFile();
        			});
        		} else {
        			writeFile();
        		}
        	});
        	return deferred.promise;
    	}
		if (typeof pm.postinstall === "function") {
	        if (options.verbose) TERM.stdout.writenl("\0cyan([sm] Running " + type + " postinstall for: " + self.path + "\0)");
	        return pm.postinstall(self, inheritOptions(options)).then(function() {
	        	return writeSourceFile();
            });
	    } else {
        	return writeSourceFile();
	    }
    });
}

Package.prototype.edit = function(pointer, options) {
	var self = this;
	return Q.call(function() {

	    if (self.vcs) {
	        TERM.stdout.writenl("\0red([sm] ERROR: Package '" + self.path + "' is already in edit mode!\0)");
	        throw true;
	    }

	    var done = Q.ref();

		var locator = self.locator;
        var parsedFromUri = URI_PARSER.parse(locator.location);
        var uri = parsedFromUri.uris["git-write"] || parsedFromUri.uris["git-read"] || false;
        if (!uri) {
            if (self.repositoryUri) {
                var parsedRepositoryUri = URI_PARSER.parse(self.repositoryUri);
                uri = parsedRepositoryUri.uris["git-write"] || parsedRepositoryUri.uris["git-read"] || false;
                if (!uri) {
                    throw new Error("Could not determine git write or read uri from '" + locator.location + "' nor `self.repositoryUri`!");
                }
                done = Q.when(done, function() {
                    return locator.relocate(uri.replace(/#[^#]*$/, "#" + locator.version)).then(function(newLocator) {
                        locator = newLocator;
                    });
                });
            }
        }

        return Q.when(done, function() {

            if (options.debug) console.log("Cloning source and copying '.git' dir into package '" + self.path + "'.");

            return self.syncWith(locator, inheritOptions(options, {
            	vcsOnly: true,
            	keepTopVcs: true,
            	now: true
            }));
        });

/*
		return self.helpers.pmForType("git").then(function(pm) {
			return pm.edit(self, self.locator, inheritOptions(options));
		});
*/
	});
}

Package.prototype.toString = function() {
	return "[package: " + this.path + "]";
}
