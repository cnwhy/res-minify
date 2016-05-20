var fs = require("fs");
var path = require('path');
var CleanCSS = require('clean-css-cnwhy');
var UglifyJS = require("uglify-js");
var less = require("less");
var qf = require('queue-fun');
var Mime = require('mime');
var _ = require('underscore');

var q = qf.Q;
var readFile = q.denodeify(fs.readFile),
	fs_stat = q.denodeify(fs.stat),
	readdir = q.denodeify(fs.readdir),
	exists = q.denodeify(fs.exists);

var memoryFiles = {};

var UglifyJSConfig = {
	mangle:{
		except : ['require']
	}
}
//存入缓存
var servpath = path.dirname(require.main.filename);

function saveCache(data, cacheOption, fun) {
	//console.log("saveCache");
	//console.log(arguments);
	var option = cacheOption;
	//option.cachePath = resServerConfig.cacheFilePaths;
	if (option.Type === "memory") {
		memoryFiles[option.Key] = data;
	} else if (option.Type === "file") {
		exists(option.fPath).then(function(){
			return q.denodeify(fs.mkdir)(option.fPath);
		}).catch(function(){})
		.then(function(){
			return q.denodeify(fs.writeFile)(path.join(option.fPath,option.Key),data);
		})
		.catch(function(err){
			console.error(err);
		})
	}
}

function getCache(cacheOption){
	//console.log("getCache");
	if (cacheOption.Type === "memory") {
		return memoryFiles[cacheOption.Key]
	}else if(cacheOption.Type === "file"){
		var cfile = path.join(cacheOption.fPath,cacheOption.Key);
		if(fs.existsSync(cfile)){
			return fs.createReadStream(cfile);
		}else{
			return;
		}
	}
}

//设置文件的头信息
function getheader(realPath,stat){
	var mime = Mime.lookup(realPath) || 'text/plain',				//文件类型对应的mime
		maxAge = this.fileMaxAge || 60 * 60 * 24 * 30,				//fileMaxAge单位为秒
		expires = new Date(Date.now() + maxAge * 1000);				//过期的具体时间
	mime += mime.indexOf("text/") == 0 ? ";charset=utf-8" : "";		//对文件类型默认加上charset
	var header = {'Content-Type': mime}
	if(this.serverCache) { 										//服务器缓存开关
		header['Expires'] = expires.toUTCString();				//浏览器缓存的到期时间,低于"Cache-Control"的"max-age";
		header['Cache-Control'] = 'max-age=' + maxAge;			//浏览器缓存时长(秒);
		header['Last-Modified'] = stat.mtime.toUTCString();		//加上文件修改时间;
	}
	return header;
}

function getDefFile(fpath,files){
	for(var i = 0; i < files.length; i++){
		var rp = path.join(fpath,files[i])
		if(fs.existsSync(rp)) return rp;
	}
}

//直接输出文件;
function sendFile(res, realPath) {
	var raw = fs.createReadStream(realPath);
	raw.pipe(res);
}

//目录浏览
function showFileList(realPath,req,res,next){
	fs.readdir(realPath, function (err, files) {
		if (err) {
			next(err);
		} else {
			var html = [];
			html.push('<!DOCTYPE html>');
			html.push('<html>')
			html.push('<head><title><%= title %></title></head>')
			html.push('<body>')
			html.push('<h1>“<%= title %>” 目录浏览：</h1>')
			html.push('<ul>')
			    html.push('<%if(parsed){%><li><a href="<%=title%>../">..</a></li><%}%>')
			    html.push('<% for(var i = 0;i<files.length;i++){%>')
			    html.push('<li><a href="<%= title + files[i] %>"><%= files[i] %></a></li>')
			    html.push('<%}%>')
			html.push('</ul>')
			html.push('</body>')
			html.push('</html>')
			var template = _.template(html.join(''));
			res.end(template({
				"title": path.normalize(path.join(req.baseUrl,req.path+"/"))
				,parsed: req.path !== "" && req.path !== "/"
				,"files": files
			}))
		}
	});
}

function compileCss(cssStr,relativeTo,rootPath,baseUrl,reAbsolute){
	var cssOptions = {
		root:rootPath, //物理基础路径 用于绝对路径的`@import` 和 reabase url
		baseUrl:baseUrl, //url 基础路径
		reAbsolute:reAbsolute, //是否 根据baseUrl 修改 CSS 中的绝对路径
		relativeTo: relativeTo //文件目路径
	}
	var deferred = q.defer();
	new CleanCSS(cssOptions).minify(cssStr,function(error, minified){
		if(error) return deferred.reject(error);
		deferred.resolve(minified.styles);
	});
	return deferred.promise;
}

function compileCssFile(realPath,rootPath,baseUrl,reAbsolute){
	var arg = Array.prototype.slice.call(arguments,0);
	arg[0] = path.dirname(realPath);
	return readFile(realPath).then(function(data){
		arg.unshift(data.toString());
		return compileCss.apply(null,arg)
	})
}

function compileLessFile(realPath,rootPath,baseUrl,reAbsolute,compressCSS){
	var arg = Array.prototype.slice.call(arguments,0,4);
	arg[0] = path.dirname(realPath);
	return readFile(realPath).then(function(data){
		var lessOptions = {
			paths:[path.dirname(realPath)]
			//relativeUrls:true,
			//rootpath:baseUrl,
			//syncImport:true,
			//processImports:true,
			//strictImports:true,
			//compress:Con.compressCSS
		}
		return q.denodeify.call(less,less.render)(data.toString(),lessOptions).then(function(output){
			if(!compressCSS) return output.css;
			arg.unshift(output.css);
			return compileCss.apply(null,arg);
		})
	})
}

var defConfigs = {
	"compressCSS": true		//css压缩
	,"reAbsolute": false	//是否转换CSS中原有的绝对路径
	,"compressJS": true		//js压缩
	,"compileLess": true	//编译Less文件
	,"serverCache": true		//服务器缓存
	,"fileMaxAge": 60 * 60 * 24 * 7	//浏览器缓存时间秒 默认一周
	,"cacheFilePaths": ""	//缓存目录 不设置则缓存到内存
	,"directoryList":false	//目录浏览
	,"defaultFile":["index.html","index.htm","default.html","default.htm"]	//默认文件,开启目录浏览后失效;
	,"baseUrl": undefined
}

//单个文件处理中间件
var resServer = module.exports = function resServer(rootPath,configs){
	var Con = _.extend({},defConfigs,configs);
	if(!fs.existsSync(rootPath)){
		console.warn(rootPath+" 不存在!")
		return function(req,res,next){next();}
	}

	return function(req,res,next){
		var realPath,baseUrl;
		baseUrl = Con.baseUrl == undefined ? req.baseUrl : Con.baseUrl;
		realPath = path.normalize(path.join(rootPath, req.path));	//文件实际路径
		//路径或文件不存在 跳出;
		if(!fs.existsSync(realPath)){return next(); /*res.status(404).end("404");*/}
		
		fs_stat(realPath).then(function(stat){
			var isDirectory = stat.isDirectory()
				,isFile = stat.isFile()
				,isCancatFile = isDirectory && req._parsedUrl.search && req._parsedUrl.search.indexOf("??") == 0
				,type,header,cacheName,cacheOption;
			var files,realPaths;
			if(!isDirectory && !isFile){return next();}
			if(isCancatFile){//合并文件基本变量
				var filesStr = req._parsedUrl.search.substr(2).replace(/\?.*$/,"");
				files = filesStr ? filesStr.split(/\s*\,+\s*/):[];
				isCancatFile = !!files.length;
			}

			if(isFile){//单个文件基本变量
				type = path.extname(realPath).toLowerCase().replace(".", "") || "*";	//获取文件类型
				header = getheader.call(Con,realPath,stat);
			}

			if(isCancatFile){
				realPaths = files.slice(0);
				realPaths = realPaths.map(function(v,i,arr){
					return path.normalize(path.join(rootPath, req.path,v));
				});
				realPaths.forEach(function(v,i,arr){
					if(v.indexOf(rootPath) == -1) throw new Error("超出权限范围!")
				})
				var lastFile = realPaths.slice(-1)[0];
				type = path.extname(lastFile).toLowerCase().replace(".", "");
				type && (header = getheader.call(Con,lastFile,stat));
			}

			//304
			if (Con.fileMaxAge && req.headers['if-modified-since'] && (req.headers['if-modified-since'] == stat.mtime.toUTCString() || isCancatFile)) { //浏览器缓存,并判断缓存后文件是否更改
					return res.status(304).end();	//res.writeHead(304, "Not Modified");res.end();
			}

			if(Con.serverCache){
				if(isFile){
					cacheName = (baseUrl+req.path).replace(/[\/\\]/g, "&");
				}else if(isCancatFile && files.length){
					cacheName = (baseUrl+req.path).replace(/[\/\\]/g, "&") + "#" + files.join("+").replace(/[\/\\]/g, "&")
				}
				cacheOption = {
					Key : cacheName,
					Type : Con.cacheFilePaths ? "file" : "memory",
					fPath : Con.cacheFilePaths
				}
				if (cacheName) {	//内存缓存
					var cache = getCache(cacheOption);
					if(typeof cache == "string"){
						return resEnd(cache,1);
					}else if(cache && typeof cache.pipe == 'function'){
						res.writeHead(200,header);
						return cache.pipe(res);
					}
				}
			}

			function resEnd(str,isCache){
				res.set(header);
				res.end(str);
				Con.serverCache && !isCache && saveCache(str, cacheOption);
			}

			if (type === "less") {
				if(isFile && Con.compileLess){
					return compileLessFile(realPath,rootPath,baseUrl,Con.reAbsolute,Con.compressCSS)
					.then(resEnd)
				}else if(isCancatFile){
					var defs = []
					for (var i = 0, j = realPaths.length; i < j; i++) {
						(function(i){
							var fp = realPaths[i];
							var def = compileLessFile(fp,rootPath,baseUrl,Con.reAbsolute,true);
							defs.push(def);
						})(i)
					}
					return q.all(defs).then(function(dataArr){
						var strs = dataArr.join('');
						if(Con.compressCSS) 
							return compileCss(strs,realPath,rootPath,baseUrl,Con.reAbsolute);
						else 
							return strs;
					}).then(resEnd)
				}
			}else if(type === "css"){
				if(isFile && Con.compressCSS){
					return compileCssFile(realPath,rootPath,baseUrl,Con.reAbsolute).then(resEnd);
				}else if(isCancatFile){
					var defs = []
					for (var i = 0, j = realPaths.length; i < j; i++) {
						(function(i){
							var fp = realPaths[i];
							var def = compileCssFile(fp,rootPath,baseUrl,Con.reAbsolute);
							defs.push(def);
						})(i)
					}
					return q.all(defs).then(function(dataArr){
						var strs = dataArr.join('');
						return compileCss(strs)
					}).then(resEnd)
				}
			}else if(type === "js"){
				if((isFile && Con.compressJS) || isCancatFile){
					return q.delay(0).then(function(){
						return UglifyJS.minify(isFile ? realPath : realPaths,UglifyJSConfig)
					}).then(function(minifyjs){
						return resEnd(minifyjs.code);
					})
				}
			}

			if(isFile){
				return res.sendFile(realPath);
			}else if(isDirectory && Con.directoryList){
				return showFileList(realPath,req,res,next);
			}else if(isDirectory){
				var df = getDefFile(realPath,Con.defaultFile);
				if(df) return res.sendFile(df);
			}
			return next();
		}).catch(function(err){
			next(err);
		})
	}
}