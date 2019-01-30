# gitzip

### Description
It can make sub-folder/sub-directory of github repository as zip and download it.

### Usage of download link via Parameters

##### Parameters

|Name|Type|Description|
|:---:|:---:|:---|
|download|string|The URL of the Github repository.|
|token|string|Your github token. If it is not assigned, Gitzip would use token from cookie.|

##### Examples

 * https://kinolien.github.io/gitzip/?download=/KinoLien/gitzip
 * https://kinolien.github.io/gitzip/?download=KinoLien/gitzip
 * https://kinolien.github.io/gitzip/?download=https://github.com/KinoLien/gitzip/tree/gh-pages
 * https://kinolien.github.io/gitzip/?download=/KinoLien/gitzip&token=12345yourtoken6789
 * https://kinolien.github.io/gitzip/?download=/d3/d3/tree/master/test&token=12345yourtoken6789
 * https://kinolien.github.io/gitzip/?download=https://github.com/d3/d3/tree/master/test&token=12345yourtoken6789

