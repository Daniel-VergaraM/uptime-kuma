/*
 * better-auth's twoFactor plugin added account-lockout tracking after repeated failed
 * TOTP attempts. Schema: https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/two-factor/schema.ts
 */
exports.up = async (knex) => {
    await knex.schema.alterTable("better_auth_twoFactor", (table) => {
        table.integer("failedVerificationCount").defaultTo(0);
        table.datetime("lockedUntil");
    });
};

exports.down = async (knex) => {
    await knex.schema.alterTable("better_auth_twoFactor", (table) => {
        table.dropColumn("failedVerificationCount");
        table.dropColumn("lockedUntil");
    });
};
