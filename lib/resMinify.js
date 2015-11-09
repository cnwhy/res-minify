var fs = require("fs");
var path = require('path');
var CleanCSS = require('clean-css-cnwhy');
var UglifyJS = require("uglify-js");
var qf = require('queue-fun');
var Mime = require('mime');
var _ = require('underscore');

var q = qf.Q;
var readFile = q.denodeify(fs.readFile),
	fs_stat = q.denodeify(fs.stat),
	readdir = q.denodeify(fs.readdir),
	exists = q.denodeify(fs.exists);

var memoryFiles = {};
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
		maxAge = this.fileMaxAge || 3600 * 30,						//fileMaxAge单位为秒
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

//
function getDefFile(fpath,files){
	for(var i = 0; i < files.length; i++){
		var rp = path.join(fpath,files[i])
		if(fs.existsSync(rp)) return rp;
	}
}

//直接输出文件;
// function sendFile(res, realPath) {
// 	var raw = fs.createReadStream(realPath);
// 	raw.pipe(res);
// }

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

			//res.render("file_list", {"title": path.normalize(path.join(obj.dirname,thispath+"/")), "files": files});
			res.end(template({
				"title": path.normalize(path.join(req.baseUrl,req.path+"/"))
				,parsed: req.path !== "" && req.path !== "/"
				,"files": files
			}))
		}
	});
}

var defConfigs = {
	"compressCSS": true		//css压缩
	,"reAbsolute": false	//是否转换CSS中原有的绝对路径
	,"compressJS": true		//js压缩
	,"serverCache":true		//服务器缓存
	,"fileMaxAge":604800	//浏览器缓存时间
	,"cacheFilePaths": ""	//缓存目录 不设置则缓存到内存
	,"directoryList":false	//目录浏览
	,"defaultFile":["index.html","index.htm","default.html","default.htm"]	//默认文件,开启目录浏览后失效;
}

//单个文件处理中间件
var resServer = module.exports = function resServer(filePath,configs){
	var Con = _.extend({},defConfigs,configs);
	if(!fs.existsSync(filePath)){
		console.warn(filePath+" 不存在!")
		return function(req,res,next){next();}
	}

	return function(req,res,next){
		var realPath,rootPath;
		realPath = path.normalize(path.join(filePath, req.path));	//文件实际路径
		//路径或文件不存在 跳出;
		if(!fs.existsSync(realPath)){return next(); /*res.status(404).end("404");*/}
		rootPath = req.baseUrl;
		
		fs_stat(realPath).then(function(stat){
			var isDirectory = stat.isDirectory()
				,isFile = stat.isFile()
				,isCancatFile = isDirectory && req._parsedUrl.search && req._parsedUrl.search.indexOf("??") == 0
				,type,header,cacheName,cacheOption;
			var files,realPaths;

			if(!isDirectory && !isFile){return next();}

			if(isFile){//单个文件基本变量
				type = path.extname(realPath).toLowerCase().replace(".", "") || "*";	//获取文件类型
				header = getheader.call(Con,realPath,stat);
			}

			if(isCancatFile){//合并文件基本变量
				files = isCancatFile ? req._parsedUrl.search.substr(2).split(/\s*,\s*/) : [];
				realPaths = files.slice(0);
				realPaths = realPaths.map(function(v,i,arr){
					return path.normalize(path.join(filePath, req.path,v));
				});
				realPaths.forEach(function(v,i,arr){
					if(v.indexOf(filePath) == -1) throw new Error("超出权限范围!")
				})
				type = path.extname(files[0]).toLowerCase().replace(".", "");
				header = getheader.call(Con,realPaths[0],stat);
			}

			//304
			if (Con.fileMaxAge && req.headers['if-modified-since'] && (req.headers['if-modified-since'] == stat.mtime.toUTCString() || isCancatFile)) { //浏览器缓存,并判断缓存后文件是否更改
					return res.status(304).end();	//res.writeHead(304, "Not Modified");res.end();
			}

			//设置mime 浏览器缓存等
			(isCancatFile || isFile) && res.set(header);

			if(Con.serverCache){
				if(isFile){
					cacheName = (req.baseUrl+req.path).replace(/[\/\\]/g, "&");
				}else if(isCancatFile && files.length){
					cacheName = (req.baseUrl+req.path).replace(/[\/\\]/g, "&") + "#" + files.join("+").replace(/[\/\\]/g, "&")
				}
				cacheOption = {
					Key : cacheName,
					Type : Con.cacheFilePaths ? "file" : "memory",
					fPath : Con.cacheFilePaths
				}
				if (cacheName) {	//内存缓存
					var cache = getCache(cacheOption);
					if(typeof cache == "string"){
						//console.log('cache 内存')
						return res.end(cache);
					}else if(cache && typeof cache.pipe == 'function'){
						//console.log('cache 文件')
						return cache.pipe(res);
					}
				}
			}
			if(type === "css" && Con.compressCSS){
				if(isFile){
					return readFile(realPath).then(function(data){
						//URL转绝对路径
						var cssOptions = {
							root:filePath, //物理基础路径 用于绝对路径的`@import` 和 reabase url
							baseUrl:req.baseUrl, //url 基础路径
							reAbsolute:Con.reAbsolute, //是否 根据baseUrl 修改 CSS 中的绝对路径
							relativeTo: path.dirname(realPath) //文件路径
						}
						// URL转相对路径
						// var cssOptions = {
						// 	relativeTo: path.dirname(realPath), //文件路径
						// 	target: path.dirname(realPath)
						// }
						var css = new CleanCSS(cssOptions).minify(data.toString());
						// res.end(css.styles);
						res.end((new CleanCSS().minify(css.styles)).styles);
						if(css.err){
							console.log(css.err);
						}else{
							Con.serverCache && saveCache(css.styles, cacheOption);
						}
						return;
					})
				}else if(isCancatFile){
					var origCode, finalCode = "";
					var baseUrl = req.baseUrl;
					var defs = []
					for (var i = 0, j = realPaths.length; i < j; i++) {
						// var realPath = _files[i];
						// var relative = path.dirname(path.relative(servpath, realPath));
						// origCode = fs.readFileSync(realPath).toString();
						// finalCode += new CleanCSS({root: servpath, relativeTo: relative}).minify(origCode);
						(function(i){
							var fp = realPaths[i];
							var def = readFile(fp).then(function(data){
								var deferred = q.defer();
								//URL转绝对路径
								var cssOptions = {
									root:filePath, //物理基础路径 用于绝对路径的`@import` 和 reabase url
									baseUrl:req.baseUrl, //url 基础路径
									reAbsolute:Con.reAbsolute, //是否 根据baseUrl 修改 CSS 中的绝对路径
									relativeTo: path.dirname(fp) //文件路径
								}
								new CleanCSS(cssOptions).minify(data.toString(),function(error, minified){
									if(error) return deferred.reject(error);
									deferred.resolve(minified.styles);
								});
								return deferred.promise;
							})
							defs.push(def);
						})(i)
					}
					return q.all(defs).then(function(dataArr){
						var strs = dataArr.join('');
						strs = new CleanCSS().minify(strs).styles;
						res.end(strs);
						Con.serverCache && saveCache(strs, cacheOption);
					})
				}else{return next()}
			}else if(type === "js" && Con.compressJS){
				if(isFile){
					var ystxt = UglifyJS.minify(realPath,{mangle:{except : ['require']}});
					res.end(ystxt.code);
					Con.serverCache && saveCache(ystxt.code, cacheOption);
					return;
				}else if(isCancatFile){
					var minifyjs = UglifyJS.minify(realPaths,{mangle:{except : ['require']}});
					res.end(minifyjs.code);
					Con.serverCache && saveCache(minifyjs.code,cacheOption);
					return;
				}else{return next()}
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




//多文件处理中间件