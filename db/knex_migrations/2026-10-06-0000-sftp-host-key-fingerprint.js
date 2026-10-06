exports.up = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        table.string("ssh_host_key_fingerprint");
    });
};

exports.down = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        table.dropColumn("ssh_host_key_fingerprint");
    });
};
