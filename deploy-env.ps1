$project = "nicehash-toolbox" # Update this to your Cloudflare Pages project name
Get-Content .env | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim().Trim('"', "'")
        if ($key -and $value) {
            Write-Output "Setting $key in Cloudflare..."
            wrangler pages project config vars set $key "$value" --project-name $project
        }
    }
}