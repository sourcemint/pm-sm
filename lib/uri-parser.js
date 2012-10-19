

var URL = require("url");


var vendors = {};

exports.parse = function(uri) {

    var parsedUri = URL.parse(uri);

    if (!parsedUri.hostname) {
        if (/^git@/.test(parsedUri.path)) {
            parsedUri.hostname = parsedUri.path.match(/git@([^:]*):/)[1];
        }
        else if (/^git:\/\//.test(parsedUri.path)) {
            parsedUri.hostname = parsedUri.path.match(/git:\/\/([^\/]*)\//)[1];
        }
        else if (/^.*\.[^\.]*\/.*\/[^\/]*$/.test(parsedUri.path) && !/^[^:\/]*:]\//.test(parsedUri.path)) {
            parsedUri = URL.parse("http://" + uri);
        }
    }

    var vendor = vendors[parsedUri.hostname];
    if (vendor) {
        parsedUri.vendor = vendor(parsedUri);
        parsedUri.locators = parsedUri.vendor.locators;
        delete parsedUri.vendor.locators;
        if (parsedUri.vendor.originalLocatorPM) {
            parsedUri.originalLocatorPM = parsedUri.vendor.originalLocatorPM
            delete parsedUri.vendor.originalLocatorPM
        }
    }

    return parsedUri;
}

vendors["github.com"] = function(parsedUri) {
    var info = {};
    var m;

    if (parsedUri.protocol === "git:") {
        var m = parsedUri.path.match(/^\/([^\/]*)\/([^\/]*).git$/);
        if (!m) {
            throw new Error("Not a valid github.com public git URL!");
        }
        info.originalLocatorPM = "git-read";
        parsedUri.path = "/" + m[1] + "/" + m[2];
        if (parsedUri.hash) {
            if (/^#\//.test(parsedUri.hash)) {
                throw new Error("Not a valid github.com URL '" + parsedUri.href + "'! Hash/branch '" + parsedUri.hash.substring(1) + "' may not begin with '/'!");
            }
            parsedUri.path += "/tree/" + parsedUri.hash.substring(1);
        }
    }
    else if (/^git@/.test(parsedUri.path)) {
        var m = parsedUri.path.match(/^git@([^:]*):([^\/]*)\/([^\/]*).git$/);
        if (!m) {
            throw new Error("Not a valid github.com private git URL!");
        }
        info.originalLocatorPM = "git-write";
        parsedUri.path = "/" + m[2] + "/" + m[3];
        if (parsedUri.hash) {
            parsedUri.path += "/tree/" + parsedUri.hash.substring(1);
        }
    }
    else if (/^\/(.*?)\.git$/.test(parsedUri.path)) {
        var m = parsedUri.path.match(/^\/([^\/]*)\/([^\/]*)\.git$/);
        if (!m) {
            throw new Error("Not a valid github.com public git URL!");
        }
        parsedUri.path = "/" + m[1] + "/" + m[2] + "/tree/master";
    }

    if((m = parsedUri.path.match(/^\/([^\/]*)\/([^\/]*)\/?(?:(?:tarball|zipball|tree|commit|commits|tags)\/(.*?))?\/?(?:\/([^\/]*))?$/))) {
        info["id"] = parsedUri.hostname;
        info["user"] = m[1];
        info["repository"] = m[2];
        info["locators"] = {
            "git-read": "git://github.com/" + info["user"] + "/" + info["repository"] + ".git",
            "git-write": "git@github.com:" + info["user"] + "/" + info["repository"] + ".git",
            "homepage": "https://github.com/" + info["user"] + "/" + info["repository"]
        };
        if (!m[3] && !m[4]) {
            info["rev"] = "master";
        }
        else if (!m[3] && m[4]) {
            info["rev"] = m[4];
            info.originalLocatorPM = "git-read";
        }
        else if (m[3] && !m[4]) {
            info["rev"] = m[3];
        }
        info["locators"]["zip"] = "https://github.com/" + info["user"] + "/" + info["repository"] + "/zipball/" + info["rev"];
        info["locators"]["tar"] = "https://github.com/" + info["user"] + "/" + info["repository"] + "/tarball/" + info["rev"];
        info["locators"]["raw"] = "https://github.com/" + info["user"] + "/" + info["repository"] + "/tarball/" + info["rev"];
    } else {
        throw new Error("Not a valid github.com URL!");
    }
    return info;      
}
