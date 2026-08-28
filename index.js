require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField
} = require("discord.js");

// ==========================================
// CONFIG
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;

const SERVER_ID = "1363588514599534742";
const WL_ROLE_ID = "1423495399997571237";
const WL_CHANNEL_ID = "1513399902388879491";
const FEMALE_TICKET_CHANNEL_ID = "1523564467441504406";

// Custom emojis
const CHECK_ORANGE = "<a:CheckOrange:1542695727971565672>";
const ORANGE_CROWN = "<a:1576orangecrown:1542695730572038174>";
const ARROW_PINK = "<a:Arrow_pink:1541990476041691156>";
const ORANGE_HEART = "<:ie_orange_theart:1542695732597891253>";

// Approval/denial messages disappear after 30 minutes
const RESPONSE_DELETE_TIME = 30 * 60 * 1000;

// Message counter
let messageCount = 0;

// ==========================================
// DISCORD CLIENT
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ==========================================
// BOT READY
// ==========================================

client.once("clientReady", () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`🏠 Server ID: ${SERVER_ID}`);
    console.log(`🎖️ WL Role ID: ${WL_ROLE_ID}`);
    console.log(`📢 WL Channel ID: ${WL_CHANNEL_ID}`);
});

// ==========================================
// MESSAGE HANDLER
// ==========================================

client.on("messageCreate", async (message) => {
    try {
        // Ignore bots
        if (message.author.bot) return;

        // Only work in your server
        if (!message.guild || message.guild.id !== SERVER_ID) return;

        // ==========================================
        // COUNT MESSAGES
        // ==========================================

        messageCount++;

        // Post WL embed every 10 messages
        if (messageCount >= 10) {
            messageCount = 0;

            const wlChannel = message.guild.channels.cache.get(WL_CHANNEL_ID);

            if (wlChannel && wlChannel.isTextBased()) {

                const serverLogo = message.guild.iconURL({
                    extension: "png",
                    size: 256
                });

                const embed = new EmbedBuilder()
                    .setDescription(
                        `# *** Requesting WL? ***\n` +
                        `> Just type "wl" and you’ll automatically receive the Whitelist role based on your Discord account age. You’ll either be accepted or declined for WL ${CHECK_ORANGE}\n\n` +

                        `# *** Bratz ${ORANGE_CROWN} ***\n` +
                        `If you’re a female player, looking to get verified to get access to all bratz exclusive channels and features, open a *** __ Female Verification __ *** ticket here. ${ARROW_PINK} <#${FEMALE_TICKET_CHANNEL_ID}>\n\n` +

                        `> This will give you access to exclusive sneak peeks and in-game benefits! ${ORANGE_HEART}\n\n` +

                        `# *** Status 🌟 ***\n` +
                        `${CHECK_ORANGE} = Whitelisted | ❎ = Denied`
                    )
                    .setThumbnail(serverLogo)
                    .setFooter({
                        text: "Lifetime Roleplay • Whitelist System"
                    });

                await wlChannel.send({
                    embeds: [embed]
                });
            }
        }

        // ==========================================
        // WL / FWL COMMAND
        // ==========================================

        const command = message.content.trim().toLowerCase();

        if (command !== "wl" && command !== "fwl") return;

        // Only allow WL command in WL channel
        if (message.channel.id !== WL_CHANNEL_ID) return;

        const member = message.member;

        if (!member) return;

        // ==========================================
        // CHECK ACCOUNT AGE
        // ==========================================

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const accountCreated = message.author.createdAt;

        // ==========================================
        // DENIED
        // ==========================================

        if (accountCreated > sixMonthsAgo) {

            await message.react("❎");

            const deniedEmbed = new EmbedBuilder()
                .setTitle("❎ WL Denied")
                .setDescription(
                    `You are not eligible for whitelist yet.\n\n` +
                    `Your Discord account must be at least **6 months old** to receive the Whitelist role.`
                )
                .setThumbnail(
                    message.guild.iconURL({
                        extension: "png",
                        size: 256
                    })
                )
                .setFooter({
                    text: "Lifetime Roleplay • Whitelist System"
                });

            const reply = await message.reply({
                embeds: [deniedEmbed]
            });

            // Delete response after 30 minutes
            setTimeout(async () => {
                try {
                    await reply.delete();
                } catch (error) {
                    console.log("⚠️ Could not delete denied message.");
                }
            }, RESPONSE_DELETE_TIME);

            return;
        }

        // ==========================================
        // GET WL ROLE
        // ==========================================

        const wlRole = message.guild.roles.cache.get(WL_ROLE_ID);

        if (!wlRole) {
            console.error("❌ WL role could not be found.");
            await message.react("❎");
            return;
        }

        // ==========================================
        // CHECK MANAGE ROLES
        // ==========================================

        if (
            !message.guild.members.me.permissions.has(
                PermissionsBitField.Flags.ManageRoles
            )
        ) {
            console.error("❌ Bot does not have Manage Roles permission.");
            await message.react("❎");
            return;
        }

        // ==========================================
        // CHECK ROLE HIERARCHY
        // ==========================================

        if (wlRole.position >= message.guild.members.me.roles.highest.position) {
            console.error("❌ WL role is above or equal to the bot's highest role.");
            await message.react("❎");
            return;
        }

        // ==========================================
        // GIVE WL ROLE
        // ==========================================

        if (!member.roles.cache.has(WL_ROLE_ID)) {
            await member.roles.add(wlRole);
        }

        // ==========================================
        // REACT
        // ==========================================

        try {
            await message.react(CHECK_ORANGE);
        } catch (error) {
            console.log("⚠️ Could not use custom CheckOrange emoji. Using ✅ instead.");
            await message.react("✅");
        }

        // ==========================================
        // APPROVED EMBED
        // ==========================================

        const approvedEmbed = new EmbedBuilder()
            .setTitle(`${CHECK_ORANGE} WL Approved!`)
            .setDescription(
                `Congratulations ${member}!\n\n` +
                `You have been automatically **Whitelisted** for **Lifetime Roleplay**.`
            )
            .setThumbnail(
                message.guild.iconURL({
                    extension: "png",
                    size: 256
                })
            )
            .setFooter({
                text: "Lifetime Roleplay • Whitelist System"
            });

        const reply = await message.reply({
            embeds: [approvedEmbed]
        });

        // Delete approval response after 30 minutes
        setTimeout(async () => {
            try {
                await reply.delete();
            } catch (error) {
                console.log("⚠️ Could not delete approval message.");
            }
        }, RESPONSE_DELETE_TIME);

        console.log(`✅ ${message.author.tag} was whitelisted.`);

    } catch (error) {
        console.error("❌ Error:", error);
    }
});

// ==========================================
// LOGIN
// ==========================================

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN environment variable is missing.");
    process.exit(1);
}

console.log("🔐 Discord token detected.");
client.login(TOKEN);