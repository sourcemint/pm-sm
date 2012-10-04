
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs");
const PM = require("./pm");
const MAPPINGS = require("mappings");


exports.for = function(packagePath) {
    return new SM(packagePath);
}


var SM = function(packagePath) {
    this.packagePath = packagePath;
}

SM.prototype.require = function(locator, callback) {
	var self = this;

	try {

		if (typeof locator === "string") {
			locator = {
				location: locator
			};
		}

		// TODO: Instead of defaulting to `npm` we should default to pm of package at `this.packagePath`.
		locator.pm = locator.pm || "npm";

		ASSERT(typeof locator === "object", "`locator` is not an object");
		ASSERT(typeof locator.location === "string", "`locator.location` is not a string");
		ASSERT(typeof locator.pm === "string", "`locator.pm` is not a string");

		var path = MAPPINGS.for(self.packagePath).resolve(locator.location, true);
		if (path && PATH.existsSync(path)) {
			locator.location = path;
		}

	} catch(err) {
		callback(err);
		return;
	}

	var packageURI = locator.location.replace(/\//g, "+");

    PM.forProgramPath(self.packagePath).then(function(pm) {
        return PM.forPackagePath(self.packagePath, pm).then(function(pm) {

			var mappings = {};
			mappings[packageURI] = [
				// Discover PM by downloading package and looking at `package.json ~ pm`.
				locator.pm,
				locator.location
			];

			// TODO: Provide option to not scan all dependencies in folders since we only care about
			//		 the one we are declaring.
	        return pm.install({
	        	now: false,
	        	verbose: false,
	        	// TODO: Implement `quiet`.
	        	quiet: true,
	        	descriptorOverlay: {
	        		mappings: mappings
	        	}
	        });
        });
    }).then(function(manifest) {

    	if (!manifest[packageURI]) {
    		throw new Error("Unable to find dependency package with alias '" + packageURI + "' in package '" + self.packagePath + "'!");
    	}

    	if (typeof locator.module !== "undefined") {
			callback(null, require(PATH.join(manifest[packageURI].path, manifest[packageURI].libDir, locator.module)));
    	}
    	else {
    		// TODO: Use `pinf` to load descriptor.
    		var descriptor = JSON.parse(FS.readFileSync(PATH.join(manifest[packageURI].path, "package.json")));

    		if (descriptor.main) {
				callback(null, require(PATH.join(manifest[packageURI].path, descriptor.main)));
    		}
    		else {
				callback(null, null);
    		}
    	}

    }).fail(callback);
}
