var repoExp = new RegExp("^https://github.com/([^/]+)/([^/]+)(/(tree|blob)/([^/]+)(/(.*))?)?");
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
            branch: matches[5],
            type: matches[4],
            path: matches[7] || '',
            inputUrl: repoUrl,
            rootUrl: root
        };
    }
};
var createURL = function(pathToFolder){
    var resolved = resolveUrl(pathToFolder);
    if(!resolved){
        throw "INVALID URL"
    }
    if(!resolved.path){
        // root
        var durl = [
            "https://github.com", resolved.author, resolved.project, 
            "archive", (resolved.branch || 'master')
        ].join('/');
        var gitURL = durl + ".zip";
        downloadZip(gitURL);
    } else{
        // get up level url
        var originInput = resolved.inputUrl;
        if(resolved.type == "tree"){
            var news = originInput.split('/');
            news.pop();
            resolved = resolveUrl(news.join('/'));
        }
        $.ajax({
            url: "https://api.github.com/repos/"+ resolved.author + 
                "/" + resolved.project + "/contents/" + resolved.path + 
                (resolved.branch? ("?ref=" + resolved.branch) : ""),
            success: function(results) {
                var templateText = '';
                if(!Array.isArray(results)){
                    if(results.message) throw ("Error: " +  results.message); 
                    else{
                        var gitURL = results.download_url;
                        downloadZip(btn);
                    };
                    return;
                }
                for(var i = 0, len = results.length; i < len; i++){
                    var item = results[i];
                    if(item.type == "dir" && item.html_url == originInput){
                        var valueText = item.path
                        var pathText = valueText.split('/').pop()
                        var urlText = item.git_url;
                        zipIt(pathText, urlText)
                        break;
                    }
                }
            },
            error: function(results){
                throw (JSON.stringify(results));
            }
        });
    }
}
var downloadZip = function(url){
    if(url){
        var down = document.createElement('a');
        down.setAttribute('download', true);
        down.href = url;
        down.addEventListener('click', function(e){ return; });
        setTimeout(function(){
            down.click();
        },100);
    }
}
var zipIt = function(zipName, url){
    if(url){
		$.ajax({
			url: url + "?recursive=1",
            success: function(results){
                var promises = [];
                var fileContents = [];
                if(results.truncated){
                    throw ("The tree travels is over than API limitation (500 files)");
                    return;
                };
                results.tree.forEach(function(item){
                    if(item.type == "blob"){
                        promises.push(Promise.resolve(
                            $.ajax({
                                url: item.url,
                                success: (function(path){
                                    return function(results){
                                        fileContents.push({path:path,content:results.content});
                                    };
                                })(item.path)
                            })	
                        ));
                    }
                });
                Promise.all(promises).then(function() {
                    var zip = new JSZip();
                    fileContents.forEach(function(item){
                        zip.file(item.path, item.content, {createFolders:true,base64:true});
                    });
                    saveAs(zip.generate({type:"blob"}), zipName + ".zip");
                },function(item){
                    if(item) throw (JSON.stringify(item) + " ERROR");
                });
            },
            error:function(e){ 
                throw (e);
            }
        })	
    }
}