return function(SECRET)
    local HttpService = game:GetService("HttpService")
    local Players = game:GetService("Players")
    local ReplicatedStorage = game:GetService("ReplicatedStorage")
    local Lighting = game:GetService("Lighting")
    local TweenService = game:GetService("TweenService")

    local WORKER_URL = "https://roblox.boycenlydwisandespasella.workers.dev"

    -- Buat RemoteEvent
    local remoteEvent = ReplicatedStorage:FindFirstChild("AdminMessage")
    if not remoteEvent then
        remoteEvent = Instance.new("RemoteEvent")
        remoteEvent.Name = "AdminMessage"
        remoteEvent.Parent = ReplicatedStorage
    end

    -- Daftar command
    local Commands = {

        broadcast = function(data)
            for _, player in Players:GetPlayers() do
                remoteEvent:FireClient(player, data.msg)
            end
        end,

        kick = function(data)
            local player = Players:FindFirstChild(data.username)
            if player then
                player:Kick(data.reason or "Kicked by admin")
            end
        end,

        set_time = function(data)
            Lighting.TimeOfDay = data.time
        end,

        set_gravity = function(data)
            workspace.Gravity = data.value
        end,

        shutdown = function()
            game:GetService("TeleportService"):TeleportAsync(
                game.PlaceId, Players:GetPlayers()
            )
        end,

    }

    -- Polling tiap 3 detik
    while true do
        local ok, res = pcall(function()
            return HttpService:RequestAsync({
                Url = WORKER_URL .. "/command?key=" .. SECRET,
                Method = "GET"
            })
        end)

        if ok and res.Success then
            local data = HttpService:JSONDecode(res.Body)
            if data.type and Commands[data.type] then
                print("[Admin] Eksekusi:", data.type)
                pcall(Commands[data.type], data)
            end
        end

        task.wait(3)
    end
end
