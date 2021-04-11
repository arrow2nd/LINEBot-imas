'use strict'
const moment = require('moment-timezone')

const convertData = {
  brand: {
    '1stVision': '765Pro (IDOLM@STER)',
    '765AS': '765Pro (IDOLM@STER)',
    DearlyStars: '876Pro (DearlyStars)',
    MillionLive: '765Pro (MillionLive!)',
    SideM: '315Pro (SideM)',
    CinderellaGirls: '346Pro (CinderellaGirls)',
    ShinyColors: '283Pro (ShinyColors)',
    Other: 'Other'
  },
  gender: {
    male: '男性',
    female: '女性'
  },
  handedness: {
    right: '右利き',
    left: '左利き',
    both: '両利き'
  },
  addUnit: [
    {
      key: '年齢',
      unit: '歳'
    },
    {
      key: '身長',
      unit: 'cm'
    },
    {
      key: '体重',
      unit: 'kg'
    },
    {
      key: '血液型',
      unit: '型'
    }
  ]
}

/**
 * プロフィールデータを編集
 *
 * @param  {Object} profile プロフィール
 * @return {Object}         編集後のプロフィール
 */
function convertProfile(profile) {
  // 判読しやすい形に変換
  if (profile.ブランド) {
    const brand = convertData.brand[profile.ブランド.value]
    profile.ブランド.value = brand || profile.ブランド.value
  }

  if (profile.性別) {
    const gender = convertData.gender[profile.性別.value]
    profile.性別.value = gender || '不明'
  }

  if (profile.利き手) {
    const handedness = convertData.handedness[profile.利き手.value]
    profile.利き手.value = handedness || '不明'
  }

  if (profile.誕生日) {
    profile.誕生日.value = moment(profile.誕生日.value, '-MM-DD').format(
      'M月D日'
    )
  }

  // 単位が必要なら追加
  for (let data of convertData.addUnit) {
    if (profile[data.key] && /[a-zA-Z0-9?]/.test(profile[data.key].value)) {
      profile[data.key].value += data.unit
    }
  }

  return profile
}

module.exports = convertProfile
