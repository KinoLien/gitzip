# gitzip

[demo site](https://kinolien.github.com/gitzip)

[demo site: Usage of download link via Parameters](https://github.com/KinoLien/gitzip/blob/gh-pages/README.md)

[demo site: Get access token steps](https://github.com/KinoLien/gitzip/blob/gh-pages/get-token-step.md)

## Description

It can make sub-folder/sub-directory of github repository as zip and download it.

You can now use the API if you would like to incorporate this into your own website. Clone this repository so that you will have the appropriate files. Then just call the API. Enjoy.

## Main features

- Get file from repo url
- Get zip from repo url
- Get zip from repo sub-directory url

## Usage

#### Get Zip from repo root/sub-directory/file url

	GitZip.zipRepo(pathToFolder[, callbackScope])
	
##### Parameters

|Name|Type|Description|
|:---:|:---:|:---|
|pathToFolder|string|The URL of the Github repository.|
|callbackScope|object|The scope of the progressCallback function. If you has registered callback, the code will execute like this: `yourcallback.apply(callbackScope, arguments)` |

##### Example

	GitZip.zipRepo("https://github.com/KinoLien/gitzip");
	GitZip.zipRepo("https://github.com/KinoLien/gitzip/tree/master/js");
	GitZip.zipRepo("https://github.com/KinoLien/gitzip/tree/master/");
	GitZip.zipRepo("https://github.com/KinoLien/gitzip/blob/master/example.html");
	GitZip.zipRepo("https://github.com/KinoLien/gitzip/tree/gh-pages/css");
	...


#### Register progress callback

	GitZip.registerCallback(inputFn);
	
##### Parameters

|Name|Type|Description|
|:---:|:---:|:---|
|inputFn|function|The callback will be called when fetch files, zipping, error occur and so on.|

###### Progress Callback Parameters

|Name|Type|Description|
|:---:|:---:|:---|
|status|string|Indicates the status description like 'error', 'prepare', 'processing', 'done'.|
|message|string|The messages of the above status.|
|percent|number|From 0 to 100, indicates the progress percentage.|



## License

Released under the [MIT license](http://www.opensource.org/licenses/MIT).

