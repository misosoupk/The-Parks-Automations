
require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField
} = require("discord.js");

// ==========================================
// THE PARKS CONFIG
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;

const SERVER_ID = "1544087768853127301";
const WL_ROLE_ID = "1544087768865443859";
const WL_CHANNEL_ID = "1544087770836897902";
const FEMALE_TICKET_CHANNEL_ID = "1544087773361868805";
const ANNOUNCEMENTS_CHANNEL_ID = "1544106344053874939";
const TEASERS_CHANNEL_ID = "1544087770836897905";

const SERVER_LOGO_URL =
    "https://cdn.discordapp.com/attachments/1544087774741663811/1565226599476105236/theparks.png";

// Custom emojis
const APPROVED_EMOJI = "<a:1814tealzverify:1565228130447138906>";
const DENIED_EMOJI = "<:x_:1565228132514930849>";
const PARKS_EMOJI = "<:emoji_1:1546574965363703958>";

// Teal embed color
const EMBED_COLOR = 0x008080;

// Delete approval and denial replies after 60 seconds
const RESPONSE_DELETE_TIME = 60 * 1000;

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
// EMBED HELPERS
// ==========================================

function createBaseEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setThumbnail(SERVER_LOGO_URL);
}

function createWhitelistInfoEmbed() {
    return createBaseEmbed()
        .setTitle(`${PARKS_EMOJI} Requesting WL?`)
        .setDescription(
            `Welcome to **The Parks!** 🌴\n` +
            `Ready to join the city? Type \`wl\` or \`fwl\` in this channel to request your Whitelist role automatically.\n\n` +

            `**Whitelist Requirements**\n` +
            `Your Discord account must be at least **6 months old** to qualify for automatic approval.\n\n` +

            `**Exclusive Hotties 💋**\n` +
            `Want access to our **Exclusive Hotties** channels, special perks, sneak peeks, and in-city benefits? Open a ticket in <#${FEMALE_TICKET_CHANNEL_ID}> to get verified!\n\n` +

            `**Stay in the Loop! 👀**\n` +
            `Keep an eye on our [announcements](https://discord.com/channels/${SERVER_ID}/${ANNOUNCEMENTS_CHANNEL_ID}) and [teasers](https://discord.com/channels/${SERVER_ID}/${TEASERS_CHANNEL_ID}) so you don't miss what's coming to The Parks!\n\n` +

            `**Whitelist Status**\n` +
            `${APPROVED_EMOJI} = Approved: Your account meets the requirements and receives the Whitelist role.\n` +
            `${DENIED_EMOJI} = Denied: Your account doesn't meet the eligibility requirements.`
        )
        .setFooter({
            text: "THE PARKS • YOUR CITY, YOUR STORY"
        });
}

// ==========================================
// BOT READY
// ==========================================

client.once("clientReady", () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`🌴 Server: The Parks (${SERVER_ID})`);
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

        // Only work in The Parks server
        if (!message.guild || message.guild.id !== SERVER_ID) return;

        // ==========================================
        // COUNT MESSAGES
        // ==========================================

        messageCount++;

        // Post WL embed every 10 non-bot messages
        if (messageCount >= 10) {
            messageCount = 0;

            const wlChannel =
                message.guild.channels.cache.get(WL_CHANNEL_ID);

            if (wlChannel && wlChannel.isTextBased()) {
                await wlChannel.send({
                    embeds: [createWhitelistInfoEmbed()]
                });
            } else {
                console.error("❌ WL channel could not be found.");
            }
        }

        // ==========================================
        // WL / FWL COMMAND
        // ==========================================

        const command = message.content.trim().toLowerCase();

        if (command !== "wl" && command !== "fwl") return;
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
        // DENIED: ACCOUNT UNDER 6 MONTHS
        // ==========================================

        if (accountCreated > sixMonthsAgo) {
            try {
                await message.react(DENIED_EMOJI);
            } catch {
                await message.react("❎").catch(() => {});
            }

            const deniedEmbed = createBaseEmbed()
                .setTitle(`${DENIED_EMOJI} WL Denied`)
                .setDescription(
                    `Hey ${member}, you aren't eligible for whitelist yet.\n\n` +
                    `Your Discord account must be at least **6 months old** to receive the Whitelist role.\n\n` +
                    `You can try again once your account meets the age requirement.`
                )
                .setFooter({
                    text: "THE PARKS • YOUR CITY, YOUR STORY"
                });

            const reply = await message.reply({
                embeds: [deniedEmbed]
            });

            setTimeout(async () => {
                try {
                    await reply.delete();
                } catch {
                    console.log("⚠️ Could not delete denied reply.");
                }
            }, RESPONSE_DELETE_TIME);

            return;
        }

        // ==========================================
        // FIND WHITELIST ROLE
        // ==========================================

        const wlRole = message.guild.roles.cache.get(WL_ROLE_ID);

        if (!wlRole) {
            console.error("❌ WL role not found. Check WL_ROLE_ID.");
            await message.react("❎").catch(() => {});
            return;
        }

        // ==========================================
        // CHECK BOT PERMISSIONS
        // ==========================================

        const botMember = message.guild.members.me;

        if (
            !botMember ||
            !botMember.permissions.has(
                PermissionsBitField.Flags.ManageRoles
            )
        ) {
            console.error("❌ Bot needs Manage Roles permission.");
            await message.react("❎").catch(() => {});
            return;
        }

        // ==========================================
        // CHECK ROLE HIERARCHY
        // ==========================================

        if (wlRole.position >= botMember.roles.highest.position) {
            console.error(
                "❌ Move the bot's highest role above the Whitelist role."
            );
            await message.react("❎").catch(() => {});
            return;
        }

        // ==========================================
        // GIVE WHITELIST ROLE
        // ==========================================

        if (!member.roles.cache.has(WL_ROLE_ID)) {
            await member.roles.add(wlRole);
        }

        // ==========================================
        // REACT TO WL MESSAGE
        // ==========================================

        try {
            await message.react(APPROVED_EMOJI);
        } catch {
            console.log("⚠️ Could not use the custom approval emoji.");
            await message.react("✅").catch(() => {});
        }

        // ==========================================
        // APPROVED REPLY
        // ==========================================

        const approvedEmbed = createBaseEmbed()
            .setTitle(`${APPROVED_EMOJI} WL Approved!`)
            .setDescription(
                `Congratulations ${member}! 🌴\n\n` +
                `Your account meets the requirements, and you've been automatically **Whitelisted** for **The Parks**.\n\n` +
                `Welcome to the city!`
            )
            .setFooter({
                text: "THE PARKS • YOUR CITY, YOUR STORY"
            });

        const reply = await message.reply({
            embeds: [approvedEmbed]
        });

        setTimeout(async () => {
            try {
                await reply.delete();
            } catch {
                console.log("⚠️ Could not delete approval reply.");
            }
        }, RESPONSE_DELETE_TIME);

        console.log(
            `✅ ${message.author.tag} was whitelisted in The Parks.`
        );

    } catch (error) {
        console.error("❌ Message handler error:", error);
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
