
// The one and only way of getting global scope in all environments
// https://stackoverflow.com/q/3277182/1008999
var _global = typeof window === 'object' && window.window === window
  ? window : typeof self === 'object' && self.self === self
  ? self : typeof global === 'object' && global.global === global
  ? global
  : this;

(function(){
    function fn(){};

    var repoExp = new RegExp("^https://github.com/([^/]+)/([^/]+)(/(tree|blob)/([^/]+)(/(.*))?)?");
    var githubProvidedUrl = new RegExp("^https://api.github.com/.*");
    var githubDownloadUrl = new RegExp("^https://raw.githubusercontent.com/.*");
    var isBusy = false;
    var isSafari = Object.prototype.toString.call(window.HTMLElement).indexOf('Constructor') > 0 && 
        /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

    var token;

    var _filterTailSlash = function(str){
        if ( str.length && str[str.length - 1] == "/" ) return str.substring(0, str.length - 1);
        return str;
    };

    var statusHandle = function(status){
        if(status == 'error' || status == 'done') isBusy = false;
        else isBusy = true;
    };

    /**
     * @typedef ResolvedURL
     * @type Object
     * @property {string} author - The project owner
     * @property {string} project - The project name
     * @property {string} branch - The default branch or other branches
     * @property {string} type - The type of url link, values: tree, blob, link?
     * @property {string} path - The path of target file/dir based on root repo url.
     * @property {string} inputUrl - The input url
     * @property {string} rootUrl - The root dir url
     */

    /**
     * This callback would call by each progress changes.
     * @callback progressCallback
     * @param {string} status - indicates the status description like 'error', 'prepare', 'processing', 'done'
     * @param {string} message - the messages of the above status.
     */
    var progressCallback = function(status, message){};

    var resolveUrl = function(repoUrl){
        if(typeof repoUrl != 'string') return;
        var matches = repoUrl.match(repoExp);
        if(matches && matches.length > 0){
            var root = (matches[5])? 
                "https://github.com/" + matches[1] + "/" + matches[2] + "/tree/" + matches[5] :
                repoUrl;
            return {
                author: matches[1],
                project: matches[2],
                branch: matches[5] || 'master',
                type: matches[4] || '',
                path: _filterTailSlash(matches[7] || ''),
                inputUrl: repoUrl,
                rootUrl: root
            };
        }
    };

    var _githubUrlChecker = {
        _workerBlobUrl: null,
        _branchChecker: function(baseUrl, branch, path){
            
            if(!this._workerBlobUrl){
                this._workerBlobUrl = URL.createObjectURL( new Blob([ '(',
                    function(){
                        //Long-running work here
                        function makeRequest (opts) {
                            var xhr = new XMLHttpRequest();
                            var params = opts.params, strParams;
                            if (params && typeof params === 'object') {
                                strParams = Object.keys(params).map(function (key) {
                                    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
                                }).join('&');
                            }
                            xhr.open(opts.method || 'GET', opts.url + "?" + strParams, false);
                            if (opts.headers) {
                                Object.keys(opts.headers).forEach(function (key) {
                                    xhr.setRequestHeader(key, opts.headers[key]);
                                });
                            }
                            xhr.send();
                            if(xhr.status == 200) return xhr.response;
                            return { status: xhr.status, statusText: xhr.statusText };
                        }
                        onmessage = function(e){
                            // e.data
                            var inputData = e.data;
                            
                            var toBreak = false;
                            var branchTry = inputData.branchTry,
                                pathTry = inputData.pathTry,
                                params = inputData.params,
                                pathTryQueue = pathTry.split('/');   // case: ["2.1", "Examples", "Evaluation", "UWPImageRecognition", "ImageRecognizerLib"]

                            if(pathTryQueue[pathTryQueue.length-1] == "") pathTryQueue.pop();
                            var results = {};
                            while(!toBreak){ // case: release, release/2.1
                                params["ref"] = branchTry;
                                
                                var res = makeRequest({
                                    url: inputData.baseUrl + pathTry,
                                    params: params
                                });

                                if(res.status){
                                    if(pathTryQueue.length){
                                        branchTry += "/" + pathTryQueue.shift();
                                        pathTry = pathTryQueue.join('/');
                                        // case: 2.1/Examples/Evaluation/UWPImageRecognition/ImageRecognizerLib, Examples/Evaluation/UWPImageRecognition/ImageRecognizerLib
                                    }else toBreak = true;
                                }else{
                                    results.branch = branchTry;
                                    results.path = pathTry;
                                    toBreak = true;
                                }
                            }
                            if(results.branch) postMessage(results);
                            else postMessage(null);
                            close();
                        };
                    }.toString(),
                ')()' ], { type: 'application/javascript' } ) );
            }
            
            var checkWorker = new Worker( this._workerBlobUrl );
            
            if(path && path[path.length-1] == "/") path = path.substring(0, path.length - 1);
            // pass parameter to worker
            checkWorker.postMessage({
                baseUrl: baseUrl,
                branchTry: branch,
                pathTry: path || "",
                params: token? { "access_token" : token } : {}
            });

            return new Promise(function(resolve, reject){
                checkWorker.onmessage = function(e){
                    // e.data
                    if(e.data && typeof e.data == "object") resolve(e.data);
                    else reject(e.data);
                };
            });
        },
        caches: [],
        /**
         * Resolve the github repo url for recognize author, project name, branch name, and so on.
         * @private
         * @param {string} repoUrl - The github repo url.
         * @return {Promise<ResolvedURL>}
         */
        check: function(repoUrl){
            if(typeof repoUrl != 'string') return Promise.reject();

            var self = this,
                results = {};

            if(repoUrl[repoUrl.length-1] == "/") repoUrl = repoUrl.substring(0, repoUrl.length - 1);
            
            if(!window.Worker){
                results = resolveUrl(repoUrl);
                if(results) return Promise.resolve(results);
                else return Promise.reject();
            }

            results.inputUrl = repoUrl;
            // load from cache
            if(self.caches.length > 0){
                for(var i = 0, len = self.caches.length; i < len; i++){
                    var item = self.caches[i];
                    // https://github.com/Microsoft/CNTK/(tree|blob)/release/2.1(/.*)?
                    var patternExp = new RegExp("^" + item.pattern);
                    var matches = repoUrl.match(patternExp);
                    if(matches && matches.length > 0){
                        results.author = item.author;
                        results.project = item.project;
                        results.branch = item.branch || "master";
                        results.type = matches[1] || "";
                        results.path = matches[3] || "";
                        results.inputUrl = repoUrl;
                        results.rootUrl = item.rootUrl;
                        return Promise.resolve(results);
                    }
                }
            }

            var matches = repoUrl.match(repoExp);
            if(matches && matches.length > 0){
                results.author = matches[1];    // case: Microsoft
                results.project = matches[2];   // case: CNTK
                results.branch = results.path = results.rootUrl = "";
                if(matches[4]){ // case: tree
                    
                    results.type = matches[4];

                    return new Promise(function(resolve, reject){
                        self._branchChecker("https://api.github.com/repos/"+ results.author + "/" + results.project + "/contents/", matches[5], matches[7])
                        .then(function(res){
                            var rootUrl = "https://github.com/" + results.author + "/" + results.project + "/tree/" + res.branch;
                            self.caches.push({
                                author: results.author,
                                project: results.project,
                                branch: res.branch,
                                pattern: "https://github.com/" + results.author + "/" + results.project + "/(tree|blob)/" + res.branch + "(/(.*))?",
                                rootUrl: rootUrl
                            });
                            results.branch = res.branch;
                            results.path = _filterTailSlash(res.path);
                            results.rootUrl = rootUrl;
                            resolve(results);
                        })
                        .catch(function(msg){ reject(msg); });
                    });
                }else{
                    results.rootUrl = "https://github.com/" + results.author + "/" + results.project;
                    return Promise.resolve(results);
                }
            }
            return Promise.reject();
        }
    }

    var _getRequestUri = function(param){
        var uri = Object.keys(param)
            .map(function(key){ return key + "=" + encodeURIComponent(param[key]); })
            .join('&');
        return uri ? ("?" + uri) : "";
    }

    // default type is "json"
    var _callAjax = function(url, params, type){
        return new Promise(function(resolve, reject){
            var xmlhttp;
            // compatible with IE7+, Firefox, Chrome, Opera, Safari
            xmlhttp = new XMLHttpRequest();
            xmlhttp.onreadystatechange = function(){
                if (xmlhttp.readyState == 4){
                    if(xmlhttp.status == 200){
                        resolve(xmlhttp);
                    }else if(xmlhttp.status >= 400){
                        reject(xmlhttp);
                    }
                }
            }
            xmlhttp.responseType = (typeof type !== "undefined") ? type : "json";
            xmlhttp.open("GET", url + _getRequestUri(params), true);
            xmlhttp.send();
        });
    };

    var _handleApiError = function(xmlResponse){
        if ( xmlResponse ) {
            var status = xmlResponse.status;
            var response = xmlResponse.response;
            var message = (response && response.message) ? response.message : xmlResponse.statusText;
            progressCallback.call(this, 'error', "Error: " + message);
        }
    };

    var _checkAndGetDownloadURL = function(url){
        if ( url ) {
            if ( githubDownloadUrl.test(url) ) return Promise.resolve(url);
            else return _githubUrlChecker
                .check(url)
                .then(function(resolved){
                    return "https://raw.githubusercontent.com/" + [resolved.author, resolved.project, resolved.branch, resolved.path].join("/");
                });
        } else return Promise.reject();
    };

    var _getContentOfGitUrl = function(url, params){
        params = params || {};
        if(token) params["access_token"] = token;
        return _callAjax(url, params)
            .then(function(xmlResponse){ 
                return xmlResponse.response.content;
            });
    };

    var _getTreeOfGitUrl = function(url, params){
        params = params || {};
        if(token) params["access_token"] = token;
        params["recursive"] = 1;
        return _callAjax(url, params)
            .then(function(xmlResponse){
                var results = xmlResponse.response;
                var nextReturn = [];
                if(results.truncated){
                    progressCallback.call(callbackScope, 'error', 'The tree travels is over than API limitation (500 files)');
                    throw ("The tree travels is over than API limitation (500 files)");
                };
                results.tree.forEach(function(item){
                    if(item.type == "blob"){
                        nextReturn.push({url: item.url, path: item.path});
                    }
                });
                return nextReturn;
            });
    };

    var _zipContents = function(filename, contents, callbackScope){
        var zip = new JSZip();
        contents.forEach(function(item){
            progressCallback.call(callbackScope, 'processing', 'Compressing ' + item.path);
            zip.file(item.path, item.content, {createFolders:true,base64:true});
        });
        if(isSafari){
            zip.generateAsync({type:"base64"})
            .then(function (content) {
                downloadZipUseElement("data:application/zip;base64," + content);
                alert("Please remember change file name to xxx.zip");
            });
        }else{
            zip.generateAsync({type:"blob"})
            .then(function (content) {
                saveAs(content, filename + ".zip");
            }, function(error){
                console.log(error);
            });
        }
        progressCallback.call(callbackScope, 'done', 'Saving ' + filename + '.zip');
    };

    /**
     * Force to trigger download dialog for any mine-type files using Native A Element.
     * @param {string} url - The URL.
     * @param {object|undefined} callbackScope - The scope of the progressCallback function.
     */
    function downloadZipUseElement(url, callbackScope){
        var down = document.createElement('a');
        down.setAttribute('download', true);
        down.href = url;
        down.addEventListener('click', function(e){
            progressCallback.call(callbackScope, 'done', 'Saving File.');
        });
        setTimeout(function(){
            // link has to be in the page DOM for it to work with Firefox
            document.body.appendChild(down);
            down.click();
            down.parentNode.removeChild(down);
        },100);
    }

    /**
     * Force to trigger download dialog for any mine-type files.
     * @param {string} url - The URL.
     * @param {object|undefined} callbackScope - The scope of the progressCallback function.
     */
    function downloadZip(url, callbackScope){
        callbackScope = callbackScope || _global;
        progressCallback.call(callbackScope, 'processing', 'Fetching target url: ' + url);
        var params = {};
        if(token) params["access_token"] = token;

        return _checkAndGetDownloadURL(url)
            .then(function(validUrl){
                return _callAjax(validUrl, params, "text")
            })
            .then(function(xmlResponse){
                var data = xmlResponse.response;
                var contentType = xmlResponse.getResponseHeader('Content-Type');

                var blob = new Blob([data], {
                    type: contentType || 'application/octet-stream'
                });

                var down = document.createElement('a');
                down.download = url.substring(url.lastIndexOf('/') + 1);
                down.href = URL.createObjectURL(blob);

                down.addEventListener('click', function(e){
                    progressCallback.call(callbackScope, 'done', 'Saving File.');
                });

                setTimeout(function(){
                    // link has to be in the page DOM for it to work with Firefox
                    document.body.appendChild(down);
                    down.click();
                    down.parentNode.removeChild(down);
                }, 100);
            })
            .catch(_handleApiError.bind(callbackScope));
    }

    /**
     * Download zip file from github api url.
     * @param {string} zipName - The zip file name.
     * @param {string} url - The github api url.
     * @param {object|undefined} callbackScope - The scope of the progressCallback function.
     */
    function zipIt(zipName, url, callbackScope){
        callbackScope = callbackScope || _global;
        if(url && githubProvidedUrl.test(url)){
            progressCallback.call(callbackScope, 'prepare', 'Fetching list of Dir contains files.');
            var params = {};
            if(token) params["access_token"] = token;
            params["recursive"] = 1;

            return _callAjax(url, params)
                .then(function(xmlResponse){
                    var results = xmlResponse.response;
                    var promises = [];
                    var fileContents = [];
                    if(results.truncated){
                        progressCallback.call(callbackScope, 'error', 'The tree travels is over than API limitation (500 files)');
                        throw ("The tree travels is over than API limitation (500 files)");
                    };
                    results.tree.forEach(function(item){
                        if(item.type == "blob"){
                            var p = {};
                            promises.push(
                                _getContentOfGitUrl(item.url, p)
                                .then(function(content){
                                    var path = item.path;
                                    fileContents.push({path:path,content:content});
                                    progressCallback.call(callbackScope, 'processing', 'Fetched ' + path + ' content.');
                                })
                            );
                        }
                    });

                    return Promise.all(promises).then(function() {
                        _zipContents(zipName, fileContents, callbackScope);
                    });
                })
                .catch(_handleApiError.bind(callbackScope));
        }
    }

    /**
     * Download zip for single file from input repo URL.
     * @param {string} pathToFolder - The URL of the Github repository.
     * @param {object|undefined} callbackScope - The scope of the progressCallback function.
     */
    function createURL(pathToFolder, callbackScope){
        if(isBusy) throw "GitZip is busy...";
        callbackScope = callbackScope || _global;
        progressCallback.call(callbackScope, 'prepare', 'Resolving URL');
        _githubUrlChecker.check(pathToFolder)
        .then(function(resolved){
            if(!resolved.path){
                // root
                var durl = [
                    "https://github.com", resolved.author, resolved.project,
                    "archive", (resolved.branch || 'master')
                ].join('/');
                var gitURL = durl + ".zip";
                // downloadZip(gitURL, callbackScope);
                downloadZipUseElement(gitURL, callbackScope);
            } else{

                progressCallback.call(callbackScope, 'prepare', 'Finding file/dir content path from resolved URL');
                var params = {};
                if(resolved.branch) params["ref"] = resolved.branch;
                if(token) params["access_token"] = token;            

                if(resolved.type == "tree"){
                    // for tree handles
                    _callAjax("https://api.github.com/repos/" + resolved.author + 
                        "/" + resolved.project + "/contents/" + resolved.path, params)
                        .then(function(xmlResponse){
                            var results = xmlResponse.response;

                            var promises = [];
                            results.forEach(function(item){
                                if( item.type == "dir") {
                                    var currentPath = item.name;
                                    promises.push(
                                        _getTreeOfGitUrl(item.git_url)
                                        .then(function(results){
                                            // add currentPath
                                            results.forEach(function(inner){ 
                                                inner.path = currentPath + "/" + inner.path;
                                                progressCallback.call(callbackScope, 'processing', 'Path: ' + inner.path + ' found.');
                                            });
                                            return results;
                                        })
                                    );
                                } else if ( item.type == "file" ) {
                                    promises.push(
                                        Promise.resolve([ { url: item.git_url, path: item.name } ])
                                    );
                                    progressCallback.call(callbackScope, 'processing', 'Path: ' + item.name + ' found.');
                                }
                            });
                            return Promise.all(promises);
                        })
                        .then(function(results){
                            return results.reduce(function(a, b){ return a.concat(b); }, []);
                        })
                        .then(function(urls){
                            var fetches = urls.map(function(item){
                                return _getContentOfGitUrl(item.url)
                                    .then(function(content){
                                        var path = item.path;
                                        progressCallback.call(callbackScope, 'processing', 'Fetched ' + path + ' content.');
                                        return { path: path, content: content };
                                    });
                            });
                            return Promise.all(fetches);
                        })
                        .then(function(contents){
                            _zipContents(resolved.path.split('/').pop(), contents, callbackScope);
                        });
                } else {
                    // for blob
                    downloadZip(
                        "https://raw.githubusercontent.com/" + [resolved.author, resolved.project, resolved.branch, resolved.path].join("/"),
                        callbackScope
                    );
                }
            }
        })
        .catch(function(){
            progressCallback.call(callbackScope, 'error', 'Invalid URL: value is [' + pathToFolder.toString() + ']');
            throw "INVALID URL";
        });
    }

    /**
     * Register the progress callback for handleing the progress is changing.
     * @param {progressCallback} inputFn - The progress callback.
     */
    function registerCallback(inputFn){
        if(typeof inputFn == 'function'){
            // progressCallback = callback;
            progressCallback = function(){
                inputFn.apply(this, arguments);
                statusHandle.apply(this, arguments);
            };
        }
    }

    function setAccessToken(strToken){
        token = strToken;
    }

    fn.zipRepo = createURL;
    fn.zipFromApiUrl = zipIt;
    fn.downloadFile = downloadZip;
    fn.registerCallback = registerCallback;
    fn.setAccessToken = setAccessToken;
    fn.urlResolver = _githubUrlChecker;

    _global.GitZip = fn.GitZip = fn;

    if (typeof module !== 'undefined') {
        module.exports = fn;
    }
})();
