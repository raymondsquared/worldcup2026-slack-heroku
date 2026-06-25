'use strict';

const CHART_BASE = 'https://quickchart.io/chart';
const HOME_COLOR = '#90CAF9';
const AWAY_COLOR = '#F48FB1';

function findStat(statistics, teamId, statType) {
  if (!Array.isArray(statistics)) return null;
  const teamStats = statistics.find((s) => s.teamId === teamId);
  if (!teamStats || !Array.isArray(teamStats.statistics)) return null;
  const stat = teamStats.statistics.find((s) => s.type === statType);
  return stat ? stat.value : null;
}

function parsePossession(value) {
  if (value == null) return null;
  const num = parseInt(String(value), 10);
  if (isNaN(num)) return null;
  return num;
}

function esc(str) {
  return String(str).replace(/'/g, "\\'");
}

function buildUrl(configStr, width, height) {
  const encoded = encodeURIComponent(configStr);
  return `${CHART_BASE}?c=${encoded}&w=${width}&h=${height}&bkg=white`;
}

function possessionChartUrl(statistics, homeTeamId, awayTeamId, homeTeamName, awayTeamName) {
  const homePoss = parsePossession(findStat(statistics, homeTeamId, 'Ball Possession'));
  const awayPoss = parsePossession(findStat(statistics, awayTeamId, 'Ball Possession'));

  if (homePoss == null || awayPoss == null) return null;

  const configStr = `{
    type:'doughnut',
    data:{
      labels:['${esc(awayTeamName)}','${esc(homeTeamName)}'],
      datasets:[{data:[${awayPoss},${homePoss}],backgroundColor:['${AWAY_COLOR}','${HOME_COLOR}'],borderWidth:0}]
    },
    options:{
      plugins:{datalabels:{color:'#999',font:{size:5,weight:'bold'},formatter:(v)=>v+'%'}},
      legend:{position:'bottom',reverse:true,labels:{fontSize:5}},
      title:{display:true,text:'Ball Possession',fontSize:5}
    }
  }`;

  return buildUrl(configStr, 160, 115);
}

function statsChartUrl(statistics, homeTeamId, awayTeamId, homeTeamName, awayTeamName) {
  const homeTotal = findStat(statistics, homeTeamId, 'Total Shots');
  const awayTotal = findStat(statistics, awayTeamId, 'Total Shots');

  if (homeTotal == null || awayTotal == null) return null;
  if (typeof homeTotal !== 'number' || typeof awayTotal !== 'number') return null;

  const labels = ['Total Shots'];
  const homeData = [homeTotal];
  const awayData = [awayTotal];

  const homeOnGoal = findStat(statistics, homeTeamId, 'Shots on Goal');
  const awayOnGoal = findStat(statistics, awayTeamId, 'Shots on Goal');
  if (typeof homeOnGoal === 'number' && typeof awayOnGoal === 'number') {
    labels.push('Shots on Goal');
    homeData.push(homeOnGoal);
    awayData.push(awayOnGoal);
  }

  const homePass = parsePossession(findStat(statistics, homeTeamId, 'Passes %'));
  const awayPass = parsePossession(findStat(statistics, awayTeamId, 'Passes %'));
  if (homePass != null && awayPass != null) {
    labels.push('Pass %');
    homeData.push(homePass);
    awayData.push(awayPass);
  }

  const homeFouls = findStat(statistics, homeTeamId, 'Fouls');
  const awayFouls = findStat(statistics, awayTeamId, 'Fouls');
  if (typeof homeFouls === 'number' && typeof awayFouls === 'number') {
    labels.push('Fouls');
    homeData.push(homeFouls);
    awayData.push(awayFouls);
  }

  const labelsStr = labels.map((l) => `'${l}'`).join(',');
  const configStr = `{
    type:'horizontalBar',
    data:{
      labels:[${labelsStr}],
      datasets:[
        {label:'${esc(homeTeamName)}',data:[${homeData.join(',')}],backgroundColor:'${HOME_COLOR}',borderWidth:0,borderRadius:5},
        {label:'${esc(awayTeamName)}',data:[${awayData.join(',')}],backgroundColor:'${AWAY_COLOR}',borderWidth:0,borderRadius:5}
      ]
    },
    options:{
      legend:{display:true,labels:{fontSize:5}},
      title:{display:true,text:'Match Stats',fontSize:5},
      scales:{xAxes:[{ticks:{beginAtZero:true,precision:0,fontSize:5}}],yAxes:[{ticks:{fontSize:5}}]},
      plugins:{datalabels:{anchor:'end',align:'end',color:'#999',font:{size:5,weight:'bold'}}}
    }
  }`;

  return buildUrl(configStr, 195, 115);
}

module.exports = { possessionChartUrl, statsChartUrl, findStat, parsePossession };
