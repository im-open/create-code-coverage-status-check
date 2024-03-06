#!/bin/bash

name=''
expectedFileName=''
actualFileName=''

for arg in "$@"; do
    case $arg in
    --name)
        name=$2
        shift # Remove argument --name from `$@`
        shift # Remove argument value from `$@`
        ;;
    --expectedFileName)
        expectedFileName=$2
        shift # Remove argument --expected from `$@`
        shift # Remove argument value from `$@`
        ;;
    --actualFileName)
        actualFileName=$2
        shift # Remove argument --actual from `$@`
        shift # Remove argument value from `$@`
        ;;
    
    esac
done

echo "
Asserting file contents match:
File with expected contents: '$expectedFileName'
File with actual contents:   '$actualFileName'"

# First make sure the actual file exists
if [ -f "$actualFileName" ]
then
  echo "The file with actual contents exists which is expected."
  actualFileContents=$(cat $actualFileName)
else
  echo "The file with actual contents does not exist which is not expected"
  exit 1
fi
expectedFileContents=$(cat $expectedFileName)

# Then print the contents
echo "::group::Expected file contents"
echo "$expectedFileContents"
echo "::endgroup::"

echo "::group::Actual file contents"
echo "$actualFileContents"
echo "::endgroup::"

# And finally compare the contents
if [ "$expectedFileContents" != "$actualFileContents" ]; then
  echo "The expected contents do not match the actual contents, which is not expected."  
  exit 1
else 
  echo "The expected and actual content values match, which is expected."
fi