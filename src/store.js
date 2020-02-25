import Vue from 'vue';
import Vuex from 'vuex';
import axios from 'axios';

import Storage from './storage';
import {getClassesChangeList, processSelectedClasses, processWithChangeList, setColorSeed} from './utils';
import apiConfig from './apiConfig';

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
    loaded: false,
    allClasses: [], // 持久化
    allCoursesMap: {},
    allClassesMap: {},
    allClassesHash: null, // 持久化
    reservedClasses: {}, // 持久化
    selectedClasses: {}, // 持久化
    trimester: null, // 持久化
    backend: null, // 持久化
    openedCourseId: null,
    hoverCourseId: null,
    previewClass: null,
    history: [],
    historyPos: 0,
    historyHold: false,
  },
  getters: {
    scheduleTableRows(state) {
      let rows = [];
      for (let i = 0; i < 13; i++) {
        rows.push([null, null, null, null, null]);
      }
      for (let courseId in state.selectedClasses) {
        if (state.selectedClasses.hasOwnProperty(courseId)) {
          let teacherId = state.selectedClasses[courseId].teacherId;
          state.selectedClasses[courseId].periods.forEach((period) => {
            rows[period[0]][period[1]] = {
              courseId: courseId,
              courseName: state.reservedClasses[courseId].courseName,
              teacherName: state.reservedClasses[courseId].classes[teacherId].teacherName,
              first: period[2],
              span: period[3],
              color: state.selectedClasses[courseId].themeColor,
              isPreview: false,
            }
          });
        }
      }
      return rows;
    },
    credits(state) {
      let result = 0;
      for (let courseId in state.selectedClasses) {
        if (state.selectedClasses.hasOwnProperty(courseId)) {
          result += parseFloat(state.reservedClasses[courseId].credit);
        }
      }
      return result;
    },
    currentData(state) {
      let keys = [];
      for (let courseId in state.reservedClasses) {
        if (state.reservedClasses.hasOwnProperty(courseId)) {
          for (let teacherId in state.reservedClasses[courseId].classes) {
            if (state.reservedClasses[courseId].classes.hasOwnProperty(teacherId)) {
              if (state.selectedClasses.hasOwnProperty(courseId) && state.selectedClasses[courseId].teacherId === teacherId) {
                keys.push(`${courseId}+${teacherId}`);
              } else {
                keys.push(`${courseId}-${teacherId}`);
              }
            }
          }
        }
      }
      keys.sort();
      return keys.join(',');
    },
    // currentHash(state) {
    //   return SHA1(keys.join(',')).toString();
    // },
  },
  mutations: {
    LOADED(state, value) {
      state.loaded = value;
    },
    ALL_CLASSES(state, value) {
      state.allClasses = value;
      let coursesMap = {}, classesMap = {};
      value.forEach((val) => {
        coursesMap[val['course_id']] = val;
        classesMap[`${val['course_id']}-${val['teacher_id']}`] = val;
      });
      state.allCoursesMap = coursesMap;
      state.allClassesMap = classesMap;
    },
    ALL_CLASSES_HASH(state, value) {
      state.allClassesHash = value;
    },
    RESERVED_CLASSES(state, value) {
      state.reservedClasses = value;
      state.previewClass = null;
    },
    SELECTED_CLASSES(state, value) {
      state.selectedClasses = value;
      state.previewClass = null;
    },
    TRIMESTER(state, value) {
      state.trimester = value;
    },
    BACKEND(state, value) {
      state.backend = value;
    },
    OPEN_COURSE_ID(state, value) {
      state.openedCourseId = value;
    },
    HOVER_COURSE_ID(state, value) {
      state.hoverCourseId = value;
    },
    PREVIEW_CLASS(state, value) {
      if (value == null || (state.selectedClasses.hasOwnProperty(value.courseId) && state.selectedClasses[value.courseId].teacherId === value.teacherId)) {
        state.previewClass = null;
      } else {
        state.previewClass = value;
      }
    },
    HISTORY_CLEAR(state) {
      if (!state.historyHold) {
        state.history = [];
        state.historyPos = 0;
      }
    },
    HISTORY_PUSH(state, value) {
      if (!state.historyHold) {
        if (state.historyPos === 0 || state.history[state.historyPos - 1] !== value) {
          state.history[state.historyPos] = value;
          state.historyPos++;
          state.history.length = state.historyPos;
        }
      }
    },
    HISTORY_POS_INCREASE(state) {
      if (!state.historyHold) {
        state.historyPos < state.history.length && state.historyPos++;
      }
    },
    HISTORY_POS_DECREASE(state) {
      if (!state.historyHold) {
        state.historyPos > 1 && state.historyPos--;
      }
    },
    HISTORY_HOLD(state, value) {
      state.historyHold = value;
    },
  },
  actions: {
    updateFromStorage(context) {
      // 从本地获取所有内容
      return new Promise((resolve) => {
        Promise.all([
          Storage.get('allClasses', []),
          Storage.get('allClassesHash', null),
          Storage.get('reservedClasses', {}),
          Storage.get('selectedClasses', {}),
          Storage.get('trimester', null),
          Storage.get('backend', null),
          Storage.get('colorSeed', 2),
        ]).then((values) => {
          context.commit('ALL_CLASSES', values[0]);
          context.commit('ALL_CLASSES_HASH', values[1]);
          context.commit('RESERVED_CLASSES', values[2]);
          context.commit('SELECTED_CLASSES', values[3]);
          context.commit('TRIMESTER', values[4]);
          context.commit('BACKEND', values[5]);
          context.commit('HISTORY_CLEAR');
          context.commit('HISTORY_PUSH', {
            data: context.getters.currentData,
            msg: null,
          });
          context.dispatch('setColorSeed', values[6]).then(() => {
            resolve();
          });
        });
      });
    },
    checkUpdateAllClasses(context) {
      // 从远程检查课程数据更新
      return new Promise((resolve, reject) => {
        axios.get(apiConfig.infoApi).then((response) => {
          let tasks = [];
          if (response.data['trimester'] !== context.state.trimester) {
            context.commit('TRIMESTER', response.data['trimester']);
            tasks.push(context.dispatch('clearAllUserData'));
            tasks.push(Storage.set('trimester', response.data['trimester']));
          }
          if (response.data['backend'] !== context.state.backend) {
            context.commit('BACKEND', response.data['backend']);
            tasks.push(Storage.set('backend', response.data['backend']));
          }
          if (response.data['hash'] === context.state.allClassesHash && Object.keys(context.state.allClasses).length > 0) {
            Promise.all(tasks).then(() => {
              resolve();
            });
          } else {
            Promise.all(tasks).then(() => {
              resolve(response.data);
            });
          }
        }).catch(() => {
          reject();
        });
      });
    },
    updateAllClasses(context, data) {
      // 从远程更新所有课程数据
      return new Promise((resolve, reject) => {
        axios.get(data['url']).then((response) => {
          let changeList = getClassesChangeList(context.state.allClasses, response.data, context.state.reservedClasses, context.state.selectedClasses, context.getters.scheduleTableRows);
          context.commit('ALL_CLASSES', response.data);
          context.commit('ALL_CLASSES_HASH', data['hash']);
          let reservedCopy = JSON.parse(JSON.stringify(context.state.reservedClasses));
          let selectedCopy = JSON.parse(JSON.stringify(context.state.selectedClasses));
          processWithChangeList(changeList, selectedCopy, reservedCopy, context.state.allClassesMap);
          for (let courseId in reservedCopy) {
            if (reservedCopy.hasOwnProperty(courseId)) {
              reservedCopy[courseId].courseName = context.state.allCoursesMap[courseId]['course_name'];
              reservedCopy[courseId].credit = context.state.allCoursesMap[courseId]['credit'];
              for (let teacherId in reservedCopy[courseId].classes) {
                if (reservedCopy[courseId].classes.hasOwnProperty(teacherId)) {
                  reservedCopy[courseId].classes[teacherId].classTime = context.state.allClassesMap[`${courseId}-${teacherId}`]['class_time'];
                  reservedCopy[courseId].classes[teacherId].teacherName = context.state.allClassesMap[`${courseId}-${teacherId}`]['teacher_name'];
                }
              }
            }
          }
          processSelectedClasses(selectedCopy, reservedCopy);
          context.commit('RESERVED_CLASSES', reservedCopy);
          context.commit('SELECTED_CLASSES', selectedCopy);
          context.commit('HISTORY_CLEAR');
          context.commit('HISTORY_PUSH', {
            data: context.getters.currentData,
            msg: null,
          });
          Promise.all([
            Storage.set('allClasses', response.data),
            Storage.set('allClassesHash', data['hash']),
            Storage.set('reservedClasses', reservedCopy),
            Storage.set('selectedClasses', selectedCopy),
          ]).then(() => {
            resolve(changeList);
          });
        }).catch(() => {
          reject();
        });
      });
    },
    setColorSeed(context, data) {
      // 设置色彩种子
      return new Promise((resolve) => {
        if (!setColorSeed(data)) {
          resolve();
          return;
        }
        let copy = JSON.parse(JSON.stringify(context.state.selectedClasses));
        processSelectedClasses(copy, context.state.reservedClasses);
        context.commit('SELECTED_CLASSES', copy);
        Promise.all([
          Storage.set('selectedClasses', copy),
          Storage.set('colorSeed', data),
        ]).then(() => {
          resolve();
        });
      })
    },
    reserveClass(context, data) {
      // 添加待选课程
      return new Promise((resolve) => {
        let copy = JSON.parse(JSON.stringify(context.state.reservedClasses));
        if (!copy.hasOwnProperty(data['course_id'])) {
          copy[data['course_id']] = {
            courseName: data['course_name'],
            credit: data['credit'],
            classes: {},
          };
        }
        copy[data['course_id']].classes[data['teacher_id']] = {
          teacherName: data['teacher_name'],
          classTime: data['class_time'],
        };
        context.commit('RESERVED_CLASSES', copy);
        context.commit('HISTORY_PUSH', {
          data: context.getters.currentData,
          msg: `添加待选 ${data['course_name']} (${data['teacher_name']})`,
        });
        Storage.set('reservedClasses', copy).then(() => {
          resolve();
        });
      });
    },
    reserveClassThenSelect(context, data) {
      // 添加待选课程并选择之
      return new Promise((resolve) => {
        // 同步代码依次序执行
        context.commit('HISTORY_HOLD', true);
        let tasks = [
          context.dispatch('reserveClass', data),
          context.dispatch('selectClass', data),
        ];
        context.commit('HISTORY_HOLD', false);
        context.commit('HISTORY_PUSH', {
          data: context.getters.currentData,
          msg: `添加待选并选择 ${data['course_name']} (${data['teacher_name']})`,
        });
        Promise.all(tasks).then(() => {
          resolve();
        });
      });
    },
    removeReservedClass(context, data) {
      // 移除待选课程
      return new Promise((resolve) => {
        context.dispatch('unselectClass', data).then(() => {
          let copy = JSON.parse(JSON.stringify(context.state.reservedClasses));
          if (copy.hasOwnProperty(data['course_id'])) {
            delete copy[data['course_id']].classes[data['teacher_id']];
            if (Object.keys(copy[data['course_id']].classes).length === 0) {
              delete copy[data['course_id']];
            }
            context.commit('RESERVED_CLASSES', copy);
            let row = context.state.allClassesMap[`${data['course_id']}-${data['teacher_id']}`];
            context.commit('HISTORY_PUSH', {
              data: context.getters.currentData,
              msg: `移除待选 ${row['course_name']} (${row['teacher_name']})`,
            });
            Storage.set('reservedClasses', copy).then(() => {
              resolve();
            });
          } else {
            resolve();
          }
        });
      });
    },
    selectClass(context, data) {
      // 选择课程
      return new Promise((resolve) => {
        let copy = JSON.parse(JSON.stringify(context.state.selectedClasses));
        copy[data['course_id']] = {
          teacherId: data['teacher_id'],
        };
        processSelectedClasses(copy, context.state.reservedClasses);
        context.commit('SELECTED_CLASSES', copy);
        let row = context.state.allClassesMap[`${data['course_id']}-${data['teacher_id']}`];
        context.commit('HISTORY_PUSH', {
          data: context.getters.currentData,
          msg: `选择课程 ${row['course_name']} (${row['teacher_name']})`,
        });
        Storage.set('selectedClasses', copy).then(() => {
          resolve();
        });
      });
    },
    unselectClass(context, data) {
      // 取消选择课程
      return new Promise((resolve) => {
        let copy = JSON.parse(JSON.stringify(context.state.selectedClasses));
        if (copy.hasOwnProperty(data['course_id']) && copy[data['course_id']].teacherId === data['teacher_id']) {
          delete copy[data['course_id']];
          processSelectedClasses(copy, context.state.reservedClasses);
          context.commit('SELECTED_CLASSES', copy);
          let row = context.state.allClassesMap[`${data['course_id']}-${data['teacher_id']}`];
          context.commit('HISTORY_PUSH', {
            data: context.getters.currentData,
            msg: `取消选择 ${row['course_name']} (${row['teacher_name']})`,
          });
          Storage.set('selectedClasses', copy).then(() => {
            resolve();
          });
        } else {
          resolve();
        }
      });
    },
    unselectClassesThenSelect(context, data) {
      // 取消选择课程然后选择课程
      return new Promise((resolve) => {
        let copy = JSON.parse(JSON.stringify(context.state.selectedClasses));
        data.unselect.forEach((data) => {
          if (copy.hasOwnProperty(data['course_id'])) {
            delete copy[data['course_id']];
          }
        });
        copy[data.select['course_id']] = {
          teacherId: data.select['teacher_id'],
        };
        processSelectedClasses(copy, context.state.reservedClasses);
        context.commit('SELECTED_CLASSES', copy);
        context.commit('HISTORY_PUSH', {
          data: context.getters.currentData,
          msg: `解决冲突并选择 ${data.select['course_name']} (${data.select['teacher_name']})`,
        });
        Storage.set('selectedClasses', copy).then(() => {
          resolve();
        });
      });
    },
    clearAllUserData(context) {
      // 清除所有用户数据
      return new Promise((resolve) => {
        context.commit('ALL_CLASSES', []);
        context.commit('RESERVED_CLASSES', {});
        context.commit('SELECTED_CLASSES', {});
        context.commit('HISTORY_CLEAR');
        context.commit('HISTORY_PUSH', {
          data: context.getters.currentData,
          msg: null,
        });
        Promise.all([
          Storage.set('allClasses', []),
          Storage.set('reservedClasses', {}),
          Storage.set('selectedClasses', {}),
        ]).then(() => {
          resolve();
        });
      });
    },
    updateFromDataString(context, data) {
      // 以XXXXXXXX+XXXX,XXXXXXXX-XXXX格式的数据字符串更新数据
      return new Promise((resolve) => {
        let items = data.split(',');
        const re = /(\S{8})([+-])(\S{4})/;
        let reserved = {}, selected = {};
        items.forEach((item) => {
          const reResult = re.exec(item);
          if (reResult != null) {
            let courseId = reResult[1], isSelected = reResult[2] === '+', teacherId = reResult[3];
            if (!reserved.hasOwnProperty(courseId)) {
              reserved[courseId] = {
                courseName: context.state.allCoursesMap[courseId]['course_name'],
                credit: context.state.allCoursesMap[courseId]['credit'],
                classes: {},
              };
            }
            reserved[courseId].classes[teacherId] = {
              teacherName: context.state.allClassesMap[`${courseId}-${teacherId}`]['teacher_name'],
              classTime: context.state.allClassesMap[`${courseId}-${teacherId}`]['class_time'],
            };
            if (isSelected) {
              selected[courseId] = {
                teacherId: teacherId,
              };
            }
          }
        });
        processSelectedClasses(selected, reserved);
        context.commit('RESERVED_CLASSES', reserved);
        context.commit('SELECTED_CLASSES', selected);
        Promise.all([
          Storage.set('reservedClasses', reserved),
          Storage.set('selectedClasses', selected),
        ]).then(() => {
          resolve();
        });
      });
    },
    updateFromBackup(context, data) {
      // 以XXXXXXXX:XXXXXXXX+XXXX,XXXXXXXX-XXXX格式的数据字符串更新数据
      return new Promise((resolve, reject) => {
        (async () => {
          let reserved = {}, selected = {};
          let hashChanged = false;
          let currentData = context.getters.currentData;
          let allClasses = context.state.allClasses, coursesMap = {}, classesMap = {};
          const hash = data.substr(0, 8);
          if (data.substr(0, 8) !== context.state.allClassesHash) {
            const response = await axios.get(apiConfig.getDataApi(hash));
            allClasses = response.data;
            hashChanged = true;
          }
          allClasses.forEach((val) => {
            coursesMap[val['course_id']] = val;
            classesMap[`${val['course_id']}-${val['teacher_id']}`] = val;
          });
          let items = data.substr(9).split(',');
          const re = /(\S{8})([+-])(\S{4})/;
          items.forEach((item) => {
            const reResult = re.exec(item);
            if (reResult != null) {
              let courseId = reResult[1], isSelected = reResult[2] === '+', teacherId = reResult[3];
              if (!reserved.hasOwnProperty(courseId)) {
                reserved[courseId] = {
                  courseName: coursesMap[courseId]['course_name'],
                  credit: coursesMap[courseId]['credit'],
                  classes: {},
                };
              }
              reserved[courseId].classes[teacherId] = {
                teacherName: classesMap[`${courseId}-${teacherId}`]['teacher_name'],
                classTime: classesMap[`${courseId}-${teacherId}`]['class_time'],
              };
              if (isSelected) {
                selected[courseId] = {
                  teacherId: teacherId,
                };
              }
            }
          });
          processSelectedClasses(selected, reserved);
          let changeList = [];
          if (hashChanged) {
            let rows = [];
            for (let i = 0; i < 13; i++) {
              rows.push([null, null, null, null, null]);
            }
            for (let courseId in selected) {
              if (selected.hasOwnProperty(courseId)) {
                let teacherId = selected[courseId].teacherId;
                selected[courseId].periods.forEach((period) => {
                  rows[period[0]][period[1]] = {
                    courseId: courseId,
                    courseName: reserved[courseId].courseName,
                    teacherName: reserved[courseId].classes[teacherId].teacherName,
                    first: period[2],
                    span: period[3],
                    color: selected[courseId].themeColor,
                    isPreview: false,
                  }
                });
              }
            }
            changeList = getClassesChangeList(allClasses, context.state.allClasses, reserved, selected, rows);
            processWithChangeList(changeList, selected, reserved, context.state.allClassesMap);
            processSelectedClasses(selected, reserved);
          }
          context.commit('RESERVED_CLASSES', reserved);
          context.commit('SELECTED_CLASSES', selected);
          if (currentData !== context.getters.currentData) {
            context.commit('HISTORY_PUSH', {
              data: context.getters.currentData,
              msg: '从备份中恢复数据',
            });
          }
          await Promise.all([
            Storage.set('reservedClasses', reserved),
            Storage.set('selectedClasses', selected),
          ]);
          return changeList;
        })().then(resolve).catch(reject);
      });
    },
    undo(context) {
      // 撤销
      return new Promise((resolve) => {
        context.commit('HISTORY_POS_DECREASE');
        context.dispatch('updateFromDataString', context.state.history[context.state.historyPos - 1].data).then(() => {
          resolve();
        });
      });
    },
    redo(context) {
      // 恢复
      return new Promise((resolve) => {
        context.commit('HISTORY_POS_INCREASE');
        context.dispatch('updateFromDataString', context.state.history[context.state.historyPos - 1].data).then(() => {
          resolve();
        });
      });
    },
  },
});
