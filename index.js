require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events
} = require("discord.js");

const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

// ==========================================
// THE PARKS CONFIGURATION
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;

const SERVER_ID = "1544087768853127301";
const WL_ROLE_ID = "1544087768865443859";
const WL_CHANNEL_ID = "1544087770836897902";
const REVIEW_CHANNEL_ID = "1572566250733838377";

const SERVER_LOGO_URL =
    "https://cdn.discordapp.com/attachments/1544087774741663811/1565226599476105236/theparks.png";

const APPROVED_EMOJI = "<a:1814tealzverify:1565228130447138906>";
const DENIED_EMOJI = "<:x_:1565228132514930849>";
const PARKS_EMOJI = "<:emoji_1:1546574965363703958>";
const PENDING_EMOJI = "🔄";

const EMBED_COLOR = 0x008080;
const MAX_VOUCHES = 5;
const MESSAGE_EMBED_INTERVAL = 8;

const VOUCH_ROLES = [
    "1544087768890736708", // Influencer
    "1545108914994155662", // Streamer
    "1544087768890736707", // Content Creator
    "1571294084168028381", // Donator
    "1544087768894155660", // Hotties
    "1544087768953786532"  // Parks Staff
];

const PARKS_STAFF_ROLE_ID = "1544087768953786532";

let messageCount = 0;

// ==========================================
// DATABASE
// ==========================================

const DATA_DIRECTORY = process.env.RAILWAY_ENVIRONMENT
    ? "/data"
    : path.join(__dirname, "data");

fs.mkdirSync(DATA_DIRECTORY, { recursive: true });

const db = new Database(
    path.join(DATA_DIRECTORY, "theparks-vouches.sqlite")
);

db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS vouchers (
        user_id TEXT PRIMARY KEY,
        used_count INTEGER DEFAULT 0,
        blacklisted INTEGER DEFAULT 0,
        blacklist_reason TEXT,
        blacklisted_by TEXT
    );

    CREATE TABLE IF NOT EXISTS vouches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voucher_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        reviewer_id TEXT,
        reviewed_at TEXT,
        source_channel_id TEXT,
        source_message_id TEXT
    );
`);

// Safely add these columns to databases created by older versions of the bot.
const vouchColumns = db.prepare("PRAGMA table_info(vouches)").all().map(column => column.name);
if (!vouchColumns.includes("source_channel_id")) {
    db.exec("ALTER TABLE vouches ADD COLUMN source_channel_id TEXT");
}
if (!vouchColumns.includes("source_message_id")) {
    db.exec("ALTER TABLE vouches ADD COLUMN source_message_id TEXT");
}

const getVoucher = db.prepare(
    "SELECT * FROM vouchers WHERE user_id = ?"
);

const createVoucher = db.prepare(`
    INSERT OR IGNORE INTO vouchers (user_id)
    VALUES (?)
`);

const getVouch = db.prepare(
    "SELECT * FROM vouches WHERE id = ?"
);

const getHistory = db.prepare(`
    SELECT * FROM vouches
    ORDER BY id DESC
    LIMIT ? OFFSET ?
`);

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

function baseEmbed() {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setThumbnail(SERVER_LOGO_URL)
        .setFooter({
            text: "THE PARKS • YOUR CITY, YOUR STORY"
        });
}

function closedWhitelistEmbed() {
    return baseEmbed()
        .setTitle(`${PARKS_EMOJI} THE PARKS • WHITELIST`)
        .setDescription(
            `**WHITELIST IS CLOSED TO THE PUBLIC** 🌴\n\n` +
            `Want to join The Parks? You'll need to be vouched for by an authorized member.\n\n` +

            `**Who Can Vouch?**\n` +
            `• <@&1544087768890736708> — Influencer\n` +
            `• <@&1545108914994155662> — Streamer\n` +
            `• <@&1544087768890736707> — Content Creator\n` +
            `• <@&1571294084168028381> — Donator\n` +
            `• <@&1544087768890736700> — Hotties\n` +
            `• <@&1544087768953786532> — Parks Staff\n\n` +

            `**Whitelist Requirements**\n` +
            `• Your Discord account must be at least **6 months old**.\n` +
            `• You must receive a vouch from an authorized member.\n` +
            `• Your request must be approved by Parks Staff.\n\n` +

            `**How To Get Vouched**\n` +
            `Ask an eligible member to type:\n` +
            `\`vouch @username\`\n\n` +

            `**Vouch Status**\n` +
            `${APPROVED_EMOJI} = Approved\n` +
            `${PENDING_EMOJI} = Pending Staff Review\n` +
            `${DENIED_EMOJI} = Denied`
        );
}

function isStaff(member) {
    return member.roles.cache.has(PARKS_STAFF_ROLE_ID);
}

function canVouch(member) {
    return VOUCH_ROLES.some(role =>
        member.roles.cache.has(role)
    );
}

async function replaceVouchReaction(channelId, messageId, newEmoji) {
    if (!channelId || !messageId) return;

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased() || !channel.messages) return;

        const sourceMessage = await channel.messages.fetch(messageId);
        const pendingReaction = sourceMessage.reactions.cache.find(
            reaction => reaction.emoji.name === PENDING_EMOJI
        );

        // Remove only the bot's own pending reaction, not reactions from members.
        if (pendingReaction) {
            await pendingReaction.users.remove(client.user.id).catch(() => {});
        }

        await sourceMessage.react(newEmoji);
    } catch (error) {
        console.error("Could not update the original vouch reaction:", error.message);
    }
}

function isEligible(user) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const oldEnough = user.createdAt <= sixMonthsAgo;
    const hasPicture = Boolean(user.avatar);

    return {
        eligible: oldEnough && hasPicture,
        oldEnough,
        hasPicture
    };
}

// ==========================================
// SLASH COMMANDS
// ==========================================

const commands = [
    new SlashCommandBuilder()
        .setName("resetvouches")
        .setDescription("Reset everyone's five-vouch allowance."),

    new SlashCommandBuilder()
        .setName("blacklistvoucher")
        .setDescription("Blacklist a member from submitting vouches.")
        .addUserOption(option =>
            option.setName("member")
                .setDescription("Member to blacklist")
                .setRequired(true))
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason for blacklist")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("unblacklistvoucher")
        .setDescription("Remove a member's vouch blacklist.")
        .addUserOption(option =>
            option.setName("member")
                .setDescription("Member to unblacklist")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("vouchhistory")
        .setDescription("View the complete vouch history.")
        .addIntegerOption(option =>
            option.setName("page")
                .setDescription("History page, 10 records per page")
                .setMinValue(1)
                .setRequired(false))
].map(command => command.toJSON());

// ==========================================
// REGISTER SLASH COMMANDS
// ==========================================

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(client.user.id, SERVER_ID),
        { body: commands }
    );

    console.log("✅ The Parks slash commands registered.");
}

// ==========================================
// BOT READY
// ==========================================

client.once(Events.ClientReady, async () => {
    console.log(`🌴 ${client.user.tag} is online!`);
    console.log("💚 The Parks Vouch System is running.");

    try {
        await registerCommands();
    } catch (error) {
        console.error("❌ Slash command registration failed:", error);
    }
});

// ==========================================
// MESSAGE HANDLER
// ==========================================

client.on(Events.MessageCreate, async message => {
    try {
        if (message.author.bot) return;
        if (!message.guild || message.guild.id !== SERVER_ID) return;

        // ======================================
        // POST WL EMBED EVERY 8 NON-BOT MESSAGES
        // ======================================

        messageCount++;

        if (messageCount >= MESSAGE_EMBED_INTERVAL) {
            messageCount = 0;

            const wlChannel = await client.channels.fetch(WL_CHANNEL_ID)
                .catch(() => null);

            if (wlChannel && wlChannel.isTextBased()) {
                await wlChannel.send({
                    embeds: [closedWhitelistEmbed()]
                });
                console.log("🌴 WL information embed posted.");
            } else {
                console.error("❌ WL channel could not be found.");
            }
        }

        // ======================================
        // VOUCH COMMAND
        // ======================================

        if (!/^vouch\s+/i.test(message.content.trim())) return;

        const voucher = message.member;
        const target = message.mentions.members.first();

        if (!target) {
            return message.reply(
                "Please mention the member you want to vouch for. Example: `vouch @username`"
            );
        }

        if (message.mentions.members.size !== 1) {
            return message.reply("Please vouch for only one member at a time.");
        }

        if (target.id === voucher.id) {
            return message.reply("You cannot vouch for yourself.");
        }

        if (target.user.bot) {
            return message.reply("You cannot vouch for a bot.");
        }

        if (!canVouch(voucher)) {
            return message.reply(
                `${DENIED_EMOJI} You don't have an authorized vouching role.`
            );
        }

        createVoucher.run(voucher.id);
        const voucherData = getVoucher.get(voucher.id);

        if (voucherData.blacklisted) {
            return message.reply(
                `${DENIED_EMOJI} You are blacklisted from submitting vouches.`
            );
        }

        if (voucherData.used_count >= MAX_VOUCHES) {
            return message.reply(
                `${DENIED_EMOJI} You have used all 5 of your vouches.`
            );
        }

        if (target.roles.cache.has(WL_ROLE_ID)) {
            return message.reply("This member is already Whitelisted.");
        }

        const eligibility = isEligible(target.user);

        if (!eligibility.eligible) {
            const reasons = [];

            if (!eligibility.oldEnough) {
                reasons.push("Your Discord account must be at least 6 months old.");
            }

            if (!eligibility.hasPicture) {
                reasons.push("You must have a custom Discord profile picture.");
            }

            await message.react(DENIED_EMOJI).catch(() => {});

            return message.reply(
                `${DENIED_EMOJI} This member isn't eligible for a vouch.\n\n` +
                reasons.join("\n")
            );
        }

        const existingPending = db.prepare(`
            SELECT id FROM vouches
            WHERE target_id = ? AND status = 'pending'
        `).get(target.id);

        if (existingPending) {
            return message.reply(
                `${PENDING_EMOJI} This member already has a pending vouch request.`
            );
        }

        const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID)
            .catch(() => null);

        if (!reviewChannel || !reviewChannel.isTextBased()) {
            return message.reply(
                "The staff review channel could not be found. Please contact Parks Staff."
            );
        }

        // Create request and use one vouch slot.
        const transaction = db.transaction(() => {
            const result = db.prepare(`
                INSERT INTO vouches
                (voucher_id, target_id, status, created_at, source_channel_id, source_message_id)
                VALUES (?, ?, 'pending', ?, ?, ?)
            `).run(
                voucher.id,
                target.id,
                new Date().toISOString(),
                message.channel.id,
                message.id
            );

            db.prepare(`
                UPDATE vouchers
                SET used_count = used_count + 1
                WHERE user_id = ?
            `).run(voucher.id);

            return Number(result.lastInsertRowid);
        });

        const vouchId = transaction();

        const requestEmbed = baseEmbed()
            .setTitle(`${PENDING_EMOJI} New Whitelist Vouch`)
            .setDescription(
                "A new member has been vouched for in **The Parks**."
            )
            .addFields(
                {
                    name: "Vouch ID",
                    value: `#${vouchId}`,
                    inline: true
                },
                {
                    name: "Voucher",
                    value: `${voucher.user.tag}\n${voucher}`,
                    inline: true
                },
                {
                    name: "Member Vouched For",
                    value: `${target.user.tag}\n${target}`,
                    inline: true
                },
                {
                    name: "Account Age Requirement",
                    value: "✅ Passed — 6 months or older"
                },
                {
                    name: "Profile Picture Check",
                    value: "✅ Custom profile picture detected"
                },
                {
                    name: "Vouch Status",
                    value: `${PENDING_EMOJI} Pending Staff Review`
                }
            )
            .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vouch_approve_${vouchId}`)
                .setLabel("Approve")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(`vouch_deny_${vouchId}`)
                .setLabel("Deny")
                .setStyle(ButtonStyle.Danger)
        );

        try {
            await reviewChannel.send({
                embeds: [requestEmbed],
                components: [buttons]
            });
        } catch (error) {
            // Refund the vouch slot if the review request cannot be delivered.
            db.prepare("DELETE FROM vouches WHERE id = ?").run(vouchId);
            db.prepare(`
                UPDATE vouchers
                SET used_count = MAX(0, used_count - 1)
                WHERE user_id = ?
            `).run(voucher.id);

            throw error;
        }

        await message.react(PENDING_EMOJI).catch(() => {});

        const used = voucherData.used_count + 1;
        const remaining = MAX_VOUCHES - used;

        await message.reply(
            `${PENDING_EMOJI} Your vouch for ${target} has been submitted!\n` +
            `You have **${remaining}/5** vouches remaining.`
        );

        await voucher.send(
            `${PENDING_EMOJI} You have vouched for **${target.user.tag}** in The Parks.\n` +
            `Your request is now waiting for Parks Staff to review.\n` +
            `Vouches used: **${used}/5**.`
        ).catch(() => {
            console.log(`Could not DM voucher ${voucher.user.tag}.`);
        });

        console.log(
            `🌴 Vouch #${vouchId}: ${voucher.user.tag} -> ${target.user.tag}`
        );

    } catch (error) {
        console.error("❌ Message handler error:", error);
    }
});

// ==========================================
// BUTTONS AND SLASH COMMANDS
// ==========================================

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (!interaction.guild || interaction.guild.id !== SERVER_ID) return;

        // ======================================
        // APPROVE / DENY BUTTONS
        // ======================================

        if (interaction.isButton()) {
            const parts = interaction.customId.split("_");

            if (parts[0] !== "vouch") return;

            if (!isStaff(interaction.member)) {
                return interaction.reply({
                    content: "❌ Only Parks Staff can review vouches.",
                    ephemeral: true
                });
            }

            const action = parts[1];
            const vouchId = Number(parts[2]);
            const record = getVouch.get(vouchId);

            if (!record || record.status !== "pending") {
                return interaction.reply({
                    content: "This vouch has already been reviewed or does not exist.",
                    ephemeral: true
                });
            }

            if (action === "approve") {
                const target = await interaction.guild.members.fetch(
                    record.target_id
                ).catch(() => null);

                if (!target) {
                    return interaction.reply({
                        content: "This member is no longer in the server.",
                        ephemeral: true
                    });
                }

                if (!isEligible(target.user).eligible) {
                    return interaction.reply({
                        content: "This member no longer meets the account age and profile picture requirements.",
                        ephemeral: true
                    });
                }

                const wlRole = interaction.guild.roles.cache.get(WL_ROLE_ID);
                const botMember = interaction.guild.members.me;

                if (
                    !wlRole ||
                    !botMember ||
                    !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
                    wlRole.position >= botMember.roles.highest.position
                ) {
                    return interaction.reply({
                        content: "The bot cannot assign the Whitelist role. Check Manage Roles and role hierarchy.",
                        ephemeral: true
                    });
                }

                await target.roles.add(wlRole);

                db.prepare(`
                    UPDATE vouches
                    SET status = 'approved',
                        reviewer_id = ?,
                        reviewed_at = ?
                    WHERE id = ? AND status = 'pending'
                `).run(
                    interaction.user.id,
                    new Date().toISOString(),
                    vouchId
                );

                const approvedEmbed = EmbedBuilder.from(
                    interaction.message.embeds[0]
                )
                    .setColor(0x20A66A)
                    .setTitle(`${APPROVED_EMOJI} Vouch Approved`)
                    .addFields({
                        name: "Review Result",
                        value: `Approved by ${interaction.user}`
                    });

                await interaction.update({
                    embeds: [approvedEmbed],
                    components: []
                });

                await replaceVouchReaction(
                    record.source_channel_id,
                    record.source_message_id,
                    APPROVED_EMOJI
                );

                await target.send(
                    `${APPROVED_EMOJI} Congratulations! You've been **Whitelisted** in **The Parks**! 🌴\n\n` +
                    `Your vouch was approved by Parks Staff. Welcome to the city! 💚`
                ).catch(() => {
                    console.log(`Could not DM approved member ${target.user.tag}.`);
                });

                console.log(`✅ Vouch #${vouchId} approved.`);

            } else if (action === "deny") {
                const denyTransaction = db.transaction(() => {
                    const update = db.prepare(`
                        UPDATE vouches
                        SET status = 'denied',
                            reviewer_id = ?,
                            reviewed_at = ?
                        WHERE id = ? AND status = 'pending'
                    `).run(
                        interaction.user.id,
                        new Date().toISOString(),
                        vouchId
                    );

                    // A denied request does not use one of the voucher's five slots.
                    if (update.changes > 0) {
                        db.prepare(`
                            UPDATE vouchers
                            SET used_count = MAX(0, used_count - 1)
                            WHERE user_id = ?
                        `).run(record.voucher_id);
                    }
                });
                denyTransaction();

                const deniedEmbed = EmbedBuilder.from(
                    interaction.message.embeds[0]
                )
                    .setColor(0xD64040)
                    .setTitle(`${DENIED_EMOJI} Vouch Denied`)
                    .addFields({
                        name: "Review Result",
                        value: `Denied by ${interaction.user}`
                    });

                await interaction.update({
                    embeds: [deniedEmbed],
                    components: []
                });

                await replaceVouchReaction(
                    record.source_channel_id,
                    record.source_message_id,
                    DENIED_EMOJI
                );

                console.log(`❌ Vouch #${vouchId} denied; vouch slot refunded.`);
            }

            return;
        }

        // ======================================
        // SLASH COMMANDS
        // ======================================

        if (!interaction.isChatInputCommand()) return;

        if (!isStaff(interaction.member)) {
            return interaction.reply({
                content: "❌ Only Parks Staff can use this command.",
                ephemeral: true
            });
        }

        if (interaction.commandName === "resetvouches") {
            db.prepare(`
                UPDATE vouchers SET used_count = 0
            `).run();

            return interaction.reply({
                content: "✅ Everyone's vouch allowance has been reset to **5 available vouches**. Previous history and blacklists were preserved.",
                ephemeral: true
            });
        }

        if (interaction.commandName === "blacklistvoucher") {
            const user = interaction.options.getUser("member");
            const reason = interaction.options.getString("reason");

            createVoucher.run(user.id);

            db.prepare(`
                UPDATE vouchers
                SET blacklisted = 1,
                    blacklist_reason = ?,
                    blacklisted_by = ?
                WHERE user_id = ?
            `).run(reason, interaction.user.id, user.id);

            return interaction.reply({
                content: `🚫 **${user.tag}** has been blacklisted from vouching.\nReason: ${reason}`,
                ephemeral: true
            });
        }

        if (interaction.commandName === "unblacklistvoucher") {
            const user = interaction.options.getUser("member");

            createVoucher.run(user.id);

            db.prepare(`
                UPDATE vouchers
                SET blacklisted = 0,
                    blacklist_reason = NULL,
                    blacklisted_by = NULL
                WHERE user_id = ?
            `).run(user.id);

            return interaction.reply({
                content: `✅ **${user.tag}** has been removed from the vouch blacklist.`,
                ephemeral: true
            });
        }

        if (interaction.commandName === "vouchhistory") {
            const page = interaction.options.getInteger("page") || 1;
            const offset = (page - 1) * 10;

            const records = getHistory.all(10, offset);

            const total = db.prepare(
                "SELECT COUNT(*) AS total FROM vouches"
            ).get().total;

            const totalPages = Math.max(1, Math.ceil(total / 10));

            if (page > totalPages) {
                return interaction.reply({
                    content: `There are only ${totalPages} history pages.`,
                    ephemeral: true
                });
            }

            const historyEmbed = baseEmbed()
                .setTitle(`📜 The Parks Vouch History — Page ${page}/${totalPages}`)
                .setDescription(
                    records.length
                        ? records.map(record => {
                            const status =
                                record.status === "approved" ? APPROVED_EMOJI :
                                record.status === "denied" ? DENIED_EMOJI :
                                PENDING_EMOJI;

                            return (
                                `**Vouch #${record.id}** ${status}\n` +
                                `Voucher: <@${record.voucher_id}>\n` +
                                `Member: <@${record.target_id}>\n` +
                                `Submitted: <t:${Math.floor(new Date(record.created_at).getTime() / 1000)}:f>\n` +
                                `Reviewed by: ${record.reviewer_id ? `<@${record.reviewer_id}>` : "Not reviewed"}`
                            );
                        }).join("\n\n")
                        : "No vouches have been submitted yet."
                )
                .setFooter({
                    text: `Total recorded vouches: ${total} • Use /vouchhistory page:<number>`
                });

            return interaction.reply({
                embeds: [historyEmbed],
                ephemeral: true
            });
        }

    } catch (error) {
        console.error("❌ Interaction error:", error);

        if (
            interaction.isRepliable() &&
            !interaction.replied &&
            !interaction.deferred
        ) {
            await interaction.reply({
                content: "Something went wrong. Please check the bot logs.",
                ephemeral: true
            }).catch(() => {});
        }
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