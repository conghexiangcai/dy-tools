window.filterDefaults={"fans":"10000","fans-min":"","works-limit":"20","works-min":"","days-min":"","days-max":"","logic":"or","mutual":"","decision":"match","works-state":"","opened-state":"","group-filter":"","sort":"difference_desc","following-greater":false,"search":"","batch-size":"5"};
window.classifyRow=function classify(row, settings) {
    const values = [];
    for (const [id, key, op, label] of [['fans', 'follower_count', 'lt', '粉丝'], ['fans-min', 'follower_count', 'gt', '粉丝'], ['works-limit', 'works_count', 'lt', '作品'], ['works-min', 'works_count', 'gt', '作品']]) {
        const raw = String(settings[id] ?? '').trim();
        if (!raw)
            continue;
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 0)
            throw Error('阈值请输入非负整数');
        const v = row[key];
        values.push({ label: `${label} ${op === 'gt' ? '>' : '<'} ${n.toLocaleString('zh-CN')}`, value: v === null ? null : op === 'gt' ? v > n : v < n });
    }
    if (settings['following-greater'])
        values.push({ label: '关注 > 粉丝', value: row.following_count === null || row.follower_count === null ? null : row.following_count > row.follower_count });
    const vals = values.map(x => x.value);
    const state = !vals.length ? 'match' : settings.logic === 'and' ? (vals.includes(false) ? 'excluded' : vals.includes(null) ? 'pending' : 'match') : (vals.includes(true) ? 'match' : vals.includes(null) ? 'pending' : 'excluded');
    return { state, matched: values.filter(x => x.value === true).map(x => x.label) };
};
window.latestAge=function latestAge(row, now = Date.now()) {
    const dates = row.recent_video_times;
    if (!Array.isArray(dates) || !dates.length)
        return null;
    const t = Date.parse(dates[0]);
    if (!Number.isFinite(t) || t > now + 60000)
        return null;
    return Math.max(0, Math.floor((now + 28800000) / 86400000) - Math.floor((t + 28800000) / 86400000));
};
window.matchesAge=function matchesAge(age, settings) {
    let match = true;
    for (const [key, op] of [['days-min', 'gt'], ['days-max', 'lt']]) {
        const raw = String(settings[key] ?? '').trim();
        if (!raw)
            continue;
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 0)
            throw Error('发布时间天数请输入非负整数');
        if (age === null || (op === 'gt' ? age <= n : age >= n))
            match = false;
    }
    return match;
};
window.matchesGroup=function matchesGroup(row, id) { if (!id)
    return true; if (id === 'unknown')
    return row.groups_status !== 'known'; if (id === 'ungrouped')
    return row.groups_status === 'known' && Array.isArray(row.groups) && row.groups.length === 0; return row.groups_status === 'known' && Array.isArray(row.groups) && row.groups.some((g) => g.id === id); };
window.accountPrivacy=function accountPrivacy(row, member) {
    if (typeof row.is_private === 'boolean' || row.is_private === null)
        return row.is_private;
    if (row.secret === 1 || row.works_status === 'private')
        return true;
    if (row.secret === 0 || row.works_status === 'verified')
        return false;
    if (row.works_status === 'privacy_unknown')
        return null;
    return member?.secret === 1 ? true : member?.secret === 0 ? false : null;
};
