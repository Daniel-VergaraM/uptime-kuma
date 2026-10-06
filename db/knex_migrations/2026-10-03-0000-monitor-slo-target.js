exports.up = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        // Target availability in percent, e.g. 99.9. Null means no target.
        table.double("slo_target").nullable().defaultTo(null);
    });
};

exports.down = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        table.dropColumn("slo_target");
    });
};
