
const Q = require("sourcemint-util-js/lib/q");
const UTIL = require("sourcemint-util-js/lib/util");
const TERM = require("sourcemint-util-js/lib/term");
const URI_PARSER = require("./uri-parser");
const SEMVER_NPM = require("semver");
const GIT_PM = require("sourcemint-pm-git/lib/pm");


exports.for = function(pm, nodeStatus) {
	var locator = new Locator();
	return {
		straightFromObject: function(object) {
			return Q.call(function() {
				locator.initFromObject(object);
				return locator;
			});
		},
		fromObject: function(object) {

		    // TODO: Add cache.

			var originalObject = UTIL.copy(object);
			return Q.call(function() {

				if (!object) {
					throw new Error("No locator object set!");
				}

				object = UTIL.copy(object);

				if (typeof object === "string") {
					object = {
						location: object
					};
				}
				if (typeof object !== "object") {
					throw new Error("Invalid locator object!");
				}

				delete object.bundled;

				if (typeof object.location !== "undefined") {
					object.pointer = object.location || undefined;
					delete object.location;
				}

				if (typeof object.pointer !== "undefined") {

					if (typeof object.pointer === "string" && object.pointer === "") {
						throw new Error("Empty locator pointer!");
					}

					/*
		            object = {
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
		            }
		            */
/*
// This is now done in ./core.js
					if (typeof object.viaPm !== "undefined" && object.viaPm === "sm") {
		                if (UTIL.isArrayLike(object.pointer)) {
		                    object.pm = object.pointer[0];
		                    object.descriptorOverlay = object.pointer[2] || false;
		                    object.pointer = object.pointer[1];
		                } else {
		                    object.pm = "sm";
		                }
					}
*/
					try {
	                    var parsedPointer = URI_PARSER.parse(object.pointer);
						// Looks like we have a 'location' in the `pointer`.
	                    if (parsedPointer.vendor && typeof parsedPointer.vendor.rev !== "undefined") {
                    		if (parsedPointer.host) {
		                    	object.location = parsedPointer.href;
		                    } else {
		                    	object.location = parsedPointer.pathname;
		                    }
	                    	if (typeof object.selector === "undefined") {
		                        object.selector = parsedPointer.vendor.rev;
		                    }
	                    } else {
	                    	if (parsedPointer.protocol && parsedPointer.slashes) {
	                    		if (parsedPointer.host) {
			                    	object.location = parsedPointer.href;
			                    } else {
			                    	object.location = parsedPointer.pathname;
			                    }
	                    	} else
	                    	if (typeof object.selector === "undefined") {
								// Looks like we have a 'selector' in the `pointer`.
								object.selector = object.pointer;
	                    	}
	                    }
					} catch(err) {
						// Looks like we have a 'selector' in the `pointer`.
						if (typeof object.selector === "undefined") {
							object.selector = object.pointer;
						}
					}

					delete object.pointer;
					delete object.viaPm;
				}
				delete object.viaAttribute;
				if (typeof object.selector !== "undefined" && object.selector === false) {
					delete object.selector;
				}

				var done = Q.ref();

				// TODO: Based on `object.pm` or `nodeStatus.status.pm` lookup latest info.

				function getNormalizedLocation(location) {
					if (/^\//.test(object.location)) {
						return "file://" + object.location;
					}
                    var parsedLocation = URI_PARSER.parse(location);
                    if (parsedLocation && parsedLocation.locators) {
                    	if (parsedLocation.locators["git-write"]) {
                    		return parsedLocation.locators["git-write"];
                    	} else
                    	if (parsedLocation.locators["tar"]) {
                    		return parsedLocation.locators["tar"];
                    	}
                    }
                    return location;
				}

				function deriveLocation(location) {
					return Q.call(function() {
						if (typeof location !== "undefined") {
							return false;
						}
						if (nodeStatus.git && nodeStatus.git.remoteUri) {
							return getNormalizedLocation(nodeStatus.git.remoteUri);
						}
						if (nodeStatus.status.repositoryUri) {
							return getNormalizedLocation(nodeStatus.status.repositoryUri);
						}
						if (nodeStatus.status.homepageUri) {
							return getNormalizedLocation(nodeStatus.status.homepageUri);
						}
						return false;
					});
				}

				// Try and convert `selector` to `version`.
				if (typeof object.selector !== "undefined" && typeof object.version === "undefined") {

					if (SEMVER_NPM.valid(object.selector)) {
						object.version = SEMVER_NPM.valid(object.selector);
					} else
					if (SEMVER_NPM.validRange(object.selector) !== null) {
						// Find latest version for `selector` taking into account engine/platform compatibility.

//console.log(" ** ", nodeStatus.npm && nodeStatus.npm.published);

						if (nodeStatus.npm && nodeStatus.npm.descriptor && nodeStatus.npm.published && nodeStatus.npm.descriptor.versions) {

							function findBestSatisfying(selector) {
								var availableVersions = Object.keys(nodeStatus.npm.descriptor.versions);
								var version = false;
								var versionIndex = -1;
								var platformVersion = nodeStatus.status.newPlatformVersion || nodeStatus.status.platformVersion || false;
								var foundVersion = false;
								while(availableVersions.length > 0) {
									version = SEMVER_NPM.maxSatisfying(availableVersions, selector) || false;
									if (!version) break;
									if (!nodeStatus.status.platformName || !platformVersion) {
										// We don't have a desired engine/platform so we just use latest satisfying version.
										foundVersion = version;
										break;
									}
									// Check if version specifies `engines` and if it does ensure it matches our engine/platform version.
									if (
										!nodeStatus.npm.descriptor.versions[version] ||
										!nodeStatus.npm.descriptor.versions[version].engines ||
										!nodeStatus.npm.descriptor.versions[version].engines[nodeStatus.status.platformName] ||
										SEMVER_NPM.satisfies(platformVersion, nodeStatus.npm.descriptor.versions[version].engines[nodeStatus.status.platformName])									
									) {
										foundVersion = version;
										break;
									}
									// Engine does not match so we throw out the version we just got and look for previous.
									versionIndex = availableVersions.indexOf(version);
									if (versionIndex === -1) throw new Error("Sanity stop.");
									availableVersions.splice(versionIndex, 1);
								}
								return foundVersion;
							}

							object.version = findBestSatisfying(object.selector) || undefined;

							// If we don't have a version by now we likely have a npm package installed that is not compatible
							// with our platform. So we look for latest compatible.
							if (typeof object.version === "undefined" && object.selector !== "*") {
								object.version = findBestSatisfying("*") || undefined;
							}
						}

						// If we still don't have a version see if selector matches a git tag.
						if (typeof object.version === "undefined") {
							done = Q.when(done, function() {
								return deriveLocation(object.location).then(function(location) {
									if (location) {
										object.location = location;
									}
									return GIT_PM.getLookupApiForPathLocation(pm, nodeStatus.status.path, object.location).then(function(git) {
										if (!git) return;
										return git.tags().then(function(tags) {
											if (!tags || !tags.tags) return;
	        								object.version = SEMVER_NPM.maxSatisfying(tags.tags, object.selector) || undefined;
	        								// TODO: Export package.json for version and see if engine is declared and it satisfies.
	        								//		 If not bracktrack versions until an engine matches.
										});
									});
								});
							});
						}
					} else if (typeof object.location !== "undefined") {
						done = Q.when(done, function() {
							return GIT_PM.getLookupApiForPathLocation(pm, nodeStatus.status.path, object.location).then(function(git) {
								if (!git) {
									// It is assumed that the `selector` is a ref or branch as it was not determined to
									// be a valid version or range above.
									// For now we assume that is is a ref and set the version.
									// TODO: Don't assume ref, clone git repo and get ref from possible branch (just like below).
									object.version = object.selector;
									return;
								}
								return git.callGit([
	                                "rev-parse",
	                                object.selector
	                            ]).then(function(result) {
	                                object.version = result.replace(/\n$/, "");
	                            }, function() {
	                            	// 'selector' not found as branch or ref in repo.
	                            });
							});
						});
					}
				}

				done = Q.when(done, function() {

					// Try and derive `location` from `version` if not set.
					if (typeof object.version !== "undefined" && typeof object.location === "undefined") {

				        if (nodeStatus.npm && nodeStatus.npm.published && nodeStatus.npm.descriptor) {
				            if (nodeStatus.npm.descriptor.versions[object.version]) {
				            	object.location = nodeStatus.npm.descriptor.versions[object.version].dist.tarball || undefined;
				            }
				        }

				        if (typeof object.location === "undefined") {
				        	// This applies to the root package or an extra package where we don't have a locator from parent
				        	// and package descriptor did not declare `pm: "npm"` and thus npm info was not loaded.
				        	// We don't assume this is a NPM package (and perform lookup by name) so we try and get location from what we have.
				        	return deriveLocation(object.location).then(function(location) {
								if (location) {
									object.location = location;
								};
							});
				        }
					}
				});

				done = Q.when(done, function() {

					if (typeof object.version !== "undefined" && typeof object.location !== "undefined") {

						// TODO: See if we have a git locator, lookup ref selector and append ref to version if ref is not tagged at version.

					}

				});

				return Q.when(done, function() {

					delete object.pm;

					if (typeof object.location !== "undefined") {
	                    object.normalizedLocation = getNormalizedLocation(object.location);
					}

					locator.initFromObject(object);
				});

			}).then(function() {

				locator.relocate = function(pointer) {
					var object = {
						pointer: pointer
					};
					return exports.for(pm, nodeStatus).fromObject(object);
				}

				return locator;
			}, function(err) {
				TERM.stderr.writenl("\0red(***** EXTRA ERROR INFO *****\0)");
				console.error("nodeStatus", nodeStatus);
				console.error("originalObject", originalObject);
				throw err;
			});
		},
		fromUri: function(uri) {
			return exports.for(pm, nodeStatus).fromObject({
				pointer: uri
			});
		}
	};
}


var Locator = function() {
	this.version = false;
	this.location = false;
	this.normalizedLocation = false;
	this.selector = false;
	this.descriptorOverlay = false;
}

Locator.prototype.initFromObject = function(object) {
	if (typeof object.version !== "undefined") {
		this.version = object.version;
	}
	if (typeof object.location !== "undefined") {
		this.location = object.location;
	}
	if (typeof object.normalizedLocation !== "undefined") {
		this.normalizedLocation = object.normalizedLocation;
	}
	if (typeof object.selector !== "undefined") {
		this.selector = object.selector;
	}
	if (typeof object.descriptorOverlay !== "undefined") {
		this.descriptorOverlay = object.descriptorOverlay;
	}
}

Locator.prototype.toRawIdentityObject = function() {
	var identity = {};
	if (this.location !== false) {
		identity.location = this.location;
	}
	if (this.version !== false) {
		identity.version = this.version;
	}
	return identity;
}

Locator.prototype.toUniqueIdentityObject = function() {
	var identity = {};
	if (this.normalizedLocation !== false) {
		identity.location = this.normalizedLocation;
	}
	if (this.version !== false) {
		identity.version = this.version;
	}
	return identity;
}

Locator.prototype.equals = function(locator) {
	if (!locator) return false;

	if (locator.normalizedLocation !== this.normalizedLocation) {
		// If this does not match, package is determined to come from different
		// sources and thus assumed to be different.
		// TODO: Compare checksums.
		return false;
	}
	if (locator.version !== false && this.version !== false) {
		if (locator.version !== this.version) {

			// Match git refs in selectors
			if (
				locator.selector === this.version ||
				this.selector === locator.version
			) return true;

			return false;
		}
	}
	return true;
}

Locator.prototype.toString = function(format) {
    if (format === "minimal") {
    	if (this.version !== false) return this.version;
    	if (this.location !== false) return this.location;
    	return "[invalid locator: " + JSON.stringify(this) + "]";
    } else
    if (format === "location" || format === "uri" || !format) {
    	if (this.normalizedLocation !== false) return this.normalizedLocation;
    }
}

