
// TODO: Relocate to `github.com/sourcemint/profile-js`.

const PROMPT = require("prompt");
const JSON_STORE = require("sourcemint-util-js/lib/json-store").JsonStore;
const Q = require("sourcemint-util-js/lib/q");


var Credentials = exports.Credentials = function(path, profileName) {
	this.file = path;
	this.profileName = profileName;
    if (!this.exists()) {
        this.init();
    }
}

Credentials.prototype = new JSON_STORE();

Credentials.prototype.requestFor = function(namespace, name) {
	var self = this;

	var deferred = Q.defer();

	var key = [namespace, name];

	if (!self.has(key)) {

		PROMPT.start();
		PROMPT.get({
		    properties: {
		        field: {
		        	message: "Please provide '" + self.profileName + "/" + namespace + "/" + name + "':",
		      		required: true
		    	}
		  	}
		}, function (err, result) {
			if (err) {
				deferred.reject(err);
				return;
			}

			self.set(key, result.field);

			deferred.resolve(result.field);
		});

	} else {
		deferred.resolve(self.get(key));
	}

	return deferred.promise;
}
