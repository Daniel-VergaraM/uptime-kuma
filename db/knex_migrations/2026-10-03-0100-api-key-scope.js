exports.up = async (knex) => {
    await knex.schema.alterTable("api_key", (table) => {
        // "full" can change data, "read" can only read. Existing keys stay full, as before.
        table.string("scope", 10).notNullable().defaultTo("full");
    });
};

exports.down = async (knex) => {
    await knex.schema.alterTable("api_key", (table) => {
        table.dropColumn("scope");
    });
};
